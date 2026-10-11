import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AnalyzeResult, BriefKind, Provider } from "../server/llm/types.ts";
import { HistoryView } from "./components/HistoryView.tsx";
import { LiveDock } from "./components/LiveDock.tsx";
import { Settings } from "./components/Settings.tsx";
import { Avatar, InfoCard, type ExplainState } from "./components/TermCard.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { TranscriptView } from "./components/TranscriptView.tsx";
import { LANG_PRESETS, PREVIOUS_TEXT_CHARS, type LangPreset } from "./config.ts";
import {
  AI_LABEL,
  AnalyzeScheduler,
  DEFAULT_SUMMARY_SECONDS,
  parseKeyterms,
  requestAnalysis,
  requestExplain,
  requestLive,
  SUMMARY_INTERVALS,
  type TranscriptRequest,
} from "./lib/analyzer.ts";
import { unitNotes, unitsBySegment } from "./lib/annotations.ts";
import { committedToTraditional, partialToTraditional, wordsToTraditional } from "./lib/chinese.ts";
import { deleteConversation, listHistory, loadConversation, saveConversation } from "./lib/history.ts";
import { fetchScribeToken, ScribeSession, type Committed, type SessionStatus } from "./lib/scribeSession.ts";
import { KIND_LABEL, mergeTerms } from "./lib/terms.ts";
import {
  addSegment,
  buildSegment,
  clockTime,
  emptyTranscript,
  setPartial,
  tailText,
  toAbsoluteWords,
  type TranscriptState,
} from "./lib/transcript.ts";
import { splitUnits } from "./lib/units.ts";
import { acquireWakeLock, releaseWakeLock } from "./lib/wakeLock.ts";
import { lookupPhoto } from "./lib/wiki.ts";
import type { Conversation, Explanation, LiveNote, Segment, Term } from "./types.ts";

type Action =
  | { type: "partial"; text: string }
  | { type: "segment"; segment: Segment }
  | { type: "load"; segments: Segment[] }
  | { type: "reset" };

function reducer(state: TranscriptState, a: Action): TranscriptState {
  switch (a.type) {
    case "partial":
      return setPartial(state, a.text);
    case "segment":
      return addSegment(state, a.segment);
    case "load":
      return { ...emptyTranscript, segments: a.segments };
    case "reset":
      return emptyTranscript;
  }
}

const PASSCODE_KEY = "liaoban.passcode";
const CONTEXT_KEY = "liaoban.context";
const AI_KEY = "liaoban.ai";
const AI_ON_KEY = "liaoban.aiOn";
const LANG_KEY = "liaoban.lang";
const KEYTERMS_KEY = "liaoban.keyterms";
const LIVE_KEY = "liaoban.summarySeconds";

// A conversation touched this recently is picked up again after a reload.
const RESUME_WITHIN_MS = 10 * 60_000;
const SAVE_DELAY_MS = 1500;
// Explanations only need the recent part of a long conversation.
const EXPLAIN_SEGMENTS = 60;
// The 在聊什麼／背景知識 answers are kept with the term explanations, under these keys.
const BRIEF_KEY: Record<BriefKind, string> = { overview: "__overview", background: "__background" };
const BRIEF_TITLE: Record<BriefKind, string> = { overview: "在聊什麼", background: "背景知識" };
const briefOf = (key: string | null) =>
  (Object.keys(BRIEF_KEY) as BriefKind[]).find((k) => BRIEF_KEY[k] === key);

function loadSetting(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode); keep it in memory only
  }
}

function loadAi(): Provider {
  const v = loadSetting(AI_KEY);
  return v in AI_LABEL ? (v as Provider) : "openai";
}

function loadLang(): LangPreset {
  const v = loadSetting(LANG_KEY);
  return v in LANG_PRESETS ? (v as LangPreset) : "auto";
}

function loadLiveSeconds(): number {
  const v = Number(loadSetting(LIVE_KEY));
  return (SUMMARY_INTERVALS as readonly number[]).includes(v) ? v : DEFAULT_SUMMARY_SECONDS;
}

/** The latest conversation if it was in use a few minutes ago (e.g. the page was reloaded). */
function resumable(): Conversation | null {
  const last = listHistory()[0];
  if (!last || Date.now() - last.updatedAt > RESUME_WITHIN_MS) return null;
  return loadConversation(last.id);
}

type AiState =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "error"; message: string }
  | { state: "done"; at: number; ms: number };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const toRequestSegments = (segments: readonly Segment[]) =>
  segments
    .map((s) => ({ id: s.id, units: splitUnits(s.text), at: clockTime(s.startMs) }))
    .filter((s) => s.units.length > 0);

export default function App() {
  const [resumed] = useState(resumable);
  const [transcript, dispatch] = useReducer(reducer, resumed, (r) =>
    r ? { ...emptyTranscript, segments: r.segments } : emptyTranscript,
  );
  const [passcode, setPasscode] = useState(() => loadSetting(PASSCODE_KEY));
  const [context, setContext] = useState(() => loadSetting(CONTEXT_KEY));
  const [ai, setAi] = useState<Provider>(loadAi);
  const [aiOn, setAiOn] = useState(() => loadSetting(AI_ON_KEY) !== "0");
  const [lang, setLang] = useState<LangPreset>(() => resumed?.lang ?? loadLang());
  const [keyterms, setKeyterms] = useState(() => loadSetting(KEYTERMS_KEY));
  const [liveSeconds, setLiveSeconds] = useState(loadLiveSeconds);

  // The current conversation (the one being recorded).
  const [convId, setConvId] = useState(() => resumed?.id ?? crypto.randomUUID());
  const [startedAt, setStartedAt] = useState(() => resumed?.startedAt ?? Date.now());
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(() => resumed?.analysis ?? null);
  const [terms, setTerms] = useState<Term[]>(() => resumed?.terms ?? []);
  const [live, setLive] = useState<LiveNote[]>(() => resumed?.live ?? []);
  const [explanations, setExplanations] = useState<Record<string, Explanation>>(() => resumed?.explanations ?? {});

  const [aiState, setAiState] = useState<AiState>({ state: "idle" });
  const [liveState, setLiveState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [explainState, setExplainState] = useState<Record<string, ExplainState>>({});
  const [openTerm, setOpenTerm] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(() => !loadSetting(PASSCODE_KEY));
  const [showHistory, setShowHistory] = useState(false);
  const [, setHistoryRev] = useState(0); // bumped to re-read the list after a delete
  // A past conversation opened from the history (read-only), or null.
  const [viewing, setViewing] = useState<Conversation | null>(null);

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recordStartedAt, setRecordStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const sessionRef = useRef<ScribeSession | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const rawPartialRef = useRef("");
  const lastLangRef = useRef<string | undefined>(undefined);
  const sessionIdRef = useRef("");
  segmentsRef.current = transcript.segments;

  const convIdRef = useRef(convId);
  convIdRef.current = convId;
  const demoRef = useRef(false); // dev ?demo: show canned results, make no AI calls
  const latest = useRef({ passcode, context, ai, aiOn, lang, keyterms });
  latest.current = { passcode, context, ai, aiOn, lang, keyterms };

  const transcriptRequest = (segments: readonly Segment[], id: string, convLang: LangPreset): TranscriptRequest => ({
    context: latest.current.context,
    conversationId: id,
    lang: convLang,
    provider: latest.current.ai,
    segments: toRequestSegments(segments),
  });
  const currentRequest = () => transcriptRequest(segmentsRef.current, convIdRef.current, latest.current.lang);

  const canCallAi = () => latest.current.aiOn && segmentsRef.current.length > 0 && !demoRef.current;

  // Key points and terms: after new speech, at most every 10 s.
  const analyzeRef = useRef<AnalyzeScheduler | null>(null);
  analyzeRef.current ??= new AnalyzeScheduler(async () => {
    if (!canCallAi()) return;
    const id = convIdRef.current;
    setAiState({ state: "busy" });
    try {
      const result = await requestAnalysis(latest.current.passcode, currentRequest());
      if (id !== convIdRef.current) return; // a new conversation started meanwhile
      setAnalysis(result);
      setTerms((prev) => mergeTerms(prev, result.terms));
      setAiState({ state: "done", at: Date.now(), ms: result.ms ?? 0 });
    } catch (e) {
      setAiState({ state: "error", message: errorText(e) });
      throw e;
    }
  });
  const analyzer = analyzeRef.current;

  // Live panel: after new speech, at most every `liveSeconds`.
  const liveRef = useRef<AnalyzeScheduler | null>(null);
  liveRef.current ??= new AnalyzeScheduler(async () => {
    if (!canCallAi()) return;
    const id = convIdRef.current;
    const at = Date.now();
    setLiveState({ busy: true });
    try {
      const r = await requestLive(latest.current.passcode, currentRequest());
      if (id !== convIdRef.current) return;
      setLive((prev) => [...prev, { title: r.title, now: r.now, points: r.points, questions: r.questions, at }]);
      setLiveState({ busy: false });
    } catch (e) {
      setLiveState({ busy: false, error: errorText(e) });
      throw e;
    }
  }, liveSeconds * 1000);
  const liveScheduler = liveRef.current;

  useEffect(
    () => () => {
      analyzer.dispose();
      liveScheduler.dispose();
    },
    [analyzer, liveScheduler],
  );

  useEffect(() => {
    liveScheduler.intervalMs = liveSeconds * 1000;
  }, [liveScheduler, liveSeconds]);

  // New committed speech, or a different model chosen → refresh (throttled).
  useEffect(() => {
    if (!aiOn || transcript.segments.length === 0) return;
    analyzer.notify();
    liveScheduler.notify();
  }, [transcript.segments.length, ai, aiOn, analyzer, liveScheduler]);

  // Photos for people, looked up once each.
  const photoLookups = useRef(new Set<string>());
  useEffect(() => {
    for (const t of terms) {
      if (t.kind !== "person" || t.photo !== undefined || photoLookups.current.has(t.key)) continue;
      photoLookups.current.add(t.key);
      void lookupPhoto(t.wiki || t.name).then((photo) => {
        photoLookups.current.delete(t.key);
        setTerms((prev) => prev.map((p) => (p.key === t.key ? { ...p, photo } : p)));
      });
    }
  }, [terms]);

  // Save the current conversation shortly after it changes.
  useEffect(() => {
    if (transcript.segments.length === 0 || demoRef.current) return;
    const t = setTimeout(() => {
      saveConversation({
        id: convId,
        startedAt,
        updatedAt: Date.now(),
        lang,
        segments: transcript.segments,
        analysis,
        terms,
        live,
        explanations,
      });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [convId, startedAt, lang, transcript.segments, analysis, terms, live, explanations]);

  // Dev only: ?demo loads a sample conversation (no microphone or AI calls).
  useEffect(() => {
    if (!import.meta.env.DEV || !new URLSearchParams(location.search).has("demo")) return;
    demoRef.current = true;
    void import("./dev/demoSegments.ts").then(({ demoSegments, demoAnalysis, demoTerms, demoLive, demoExplanation, demoAnswer }) => {
      const segments = demoSegments();
      dispatch({ type: "load", segments });
      setAnalysis(demoAnalysis(segments));
      setTerms(demoTerms());
      setLive([demoLive()]);
      setExplanations({ "jokowi 假學歷爭議": demoExplanation(), "jason mraz 最新的歌叫什麼？": demoAnswer() });
      setOpenTerm("jokowi 假學歷爭議");
      setAiState({ state: "done", at: Date.now(), ms: 2310 });
      setShowSettings(false);
    });
  }, []);

  // What's on screen: the current conversation, or a past one opened from the history.
  const shown = viewing ?? {
    id: convId,
    segments: transcript.segments,
    analysis,
    terms,
    live,
    explanations,
    lang,
  };
  const shownState: TranscriptState = viewing ? { ...emptyTranscript, segments: viewing.segments } : transcript;
  const units = useMemo(() => unitsBySegment(shown.segments), [shown.segments]);
  const unitMarks = useMemo(() => unitNotes(shown.segments, units, shown.analysis), [shown.segments, units, shown.analysis]);
  const termsNewestFirst = useMemo(() => [...shown.terms].sort((a, b) => b.firstSeen - a.firstSeen), [shown.terms]);
  const openTermObj = shown.terms.find((t) => t.key === openTerm);
  const canAsk = Boolean(passcode) && aiOn && shown.segments.length > 0 && !demoRef.current;

  /**
   * Explains a term (or gives the overview / background, for a brief key) of
   * whichever conversation is on screen, and keeps the answer with it.
   */
  const explain = async (key: string) => {
    const conv = viewing;
    const brief = briefOf(key);
    const term = brief ? undefined : (conv ? conv.terms : terms).find((t) => t.key === key);
    if ((!brief && !term) || !canAsk) return;
    const segs = (conv ? conv.segments : segmentsRef.current).slice(-EXPLAIN_SEGMENTS);
    const req = transcriptRequest(segs, conv ? conv.id : convIdRef.current, conv ? conv.lang : latest.current.lang);
    setExplainState((s) => ({ ...s, [key]: { busy: true } }));
    try {
      const r = await requestExplain(
        latest.current.passcode,
        req,
        brief
          ? { brief }
          : {
              term: {
                name: term!.name,
                kind: term!.kind,
                mentions: term!.mentions,
                ...(term!.gist ? { gist: term!.gist } : {}),
              },
            },
      );
      const ex: Explanation = { lines: r.lines, sources: r.sources, searched: r.searched, at: Date.now() };
      if (conv) {
        setViewing((v) => {
          if (!v || v.id !== conv.id) return v;
          const next = { ...v, explanations: { ...v.explanations, [key]: ex } };
          saveConversation(next);
          return next;
        });
      } else if (conv === null && convIdRef.current === req.conversationId) {
        setExplanations((prev) => ({ ...prev, [key]: ex }));
      }
      setExplainState((s) => ({ ...s, [key]: { busy: false } }));
    } catch (e) {
      setExplainState((s) => ({ ...s, [key]: { busy: false, error: errorText(e) } }));
    }
  };

  const openTermCard = (key: string) => {
    setOpenTerm(key);
    if (!shown.explanations[key] && !explainState[key]?.busy) void explain(key);
  };

  /** The conversation moves on, so the two buttons always ask again (the last answer shows meanwhile). */
  const openBrief = (kind: BriefKind) => {
    const key = BRIEF_KEY[kind];
    setOpenTerm(key);
    if (!explainState[key]?.busy) void explain(key);
  };

  // Questions the speakers wonder about (e.g. which song) are looked up right away.
  const autoAsked = useRef(new Set<string>());
  useEffect(() => {
    if (viewing || !canAsk) return;
    for (const t of terms) {
      if (t.kind !== "question" || explanations[t.key] || autoAsked.current.has(t.key)) continue;
      autoAsked.current.add(t.key);
      void explain(t.key);
    }
    // explain reads the latest state; re-run only when the terms change.
  }, [terms, viewing, canAsk]);

  useEffect(() => {
    if (recordStartedAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [recordStartedAt]);

  /** Keeps text the service never committed (dropped connection, Stop mid-sentence). */
  const salvagePartial = () => {
    const raw = rawPartialRef.current.trim();
    rawPartialRef.current = "";
    if (!raw) return;
    const segLang = lastLangRef.current;
    dispatch({
      type: "segment",
      segment: buildSegment({
        id: crypto.randomUUID(),
        sessionId: sessionIdRef.current,
        ...(segLang ? { lang: segLang } : {}),
        textRaw: raw,
        text: segLang ? committedToTraditional(raw, segLang) : partialToTraditional(raw),
        words: [],
        fallbackMs: Date.now(),
      }),
    });
  };

  const onCommitted = (c: Committed) => {
    rawPartialRef.current = "";
    sessionIdRef.current = c.sessionId;
    if (c.lang) lastLangRef.current = c.lang;
    const words = wordsToTraditional(toAbsoluteWords(c.words, c.originMs), c.lang);
    dispatch({
      type: "segment",
      segment: buildSegment({
        id: crypto.randomUUID(),
        sessionId: c.sessionId,
        ...(c.lang ? { lang: c.lang } : {}),
        textRaw: c.text,
        text: committedToTraditional(c.text, c.lang),
        words,
        fallbackMs: Date.now(),
      }),
    });
  };

  const start = async () => {
    setError(null);
    setNotice(null);
    setViewing(null);
    setShowHistory(false);
    if (segmentsRef.current.length === 0) setStartedAt(Date.now());
    // The first live update comes one interval after recording starts, not after the first sentence.
    liveScheduler.holdOff();
    const session = new ScribeSession(
      {
        getToken: () => fetchScribeToken(passcode),
        getPreviousText: () => tailText(segmentsRef.current, PREVIOUS_TEXT_CHARS),
        getKeyterms: () => parseKeyterms(latest.current.keyterms),
        getLanguage: () => LANG_PRESETS[latest.current.lang],
      },
      {
        onStatus: (s) => {
          setStatus(s);
          if (s === "live") setNotice(null);
        },
        onPartial: (text) => {
          rawPartialRef.current = text;
          dispatch({ type: "partial", text: partialToTraditional(text, lastLangRef.current) });
        },
        onCommitted,
        onReconnecting: (reason) => {
          salvagePartial();
          setNotice(`重新連線 Reconnecting: ${reason}`);
        },
        onError: (message, fatal) => {
          if (fatal) {
            setError(message);
            setRecording(false);
            setRecordStartedAt(null);
            sessionRef.current = null;
            void releaseWakeLock();
          } else {
            setNotice(message);
          }
        },
      },
    );
    sessionRef.current = session;
    setRecording(true);
    setRecordStartedAt(Date.now());
    setNow(Date.now());
    const locked = await acquireWakeLock();
    if (!locked) setNotice("螢幕可能會自動關閉（這個瀏覽器不支援 Wake Lock）");
    await session.start();
  };

  const stop = async () => {
    setBusy(true);
    try {
      await sessionRef.current?.stop();
    } finally {
      sessionRef.current = null;
      salvagePartial();
      setRecording(false);
      setRecordStartedAt(null);
      setBusy(false);
      await releaseWakeLock();
    }
  };

  const newConversation = () => {
    dispatch({ type: "reset" });
    setConvId(crypto.randomUUID());
    setStartedAt(Date.now());
    setAnalysis(null);
    setTerms([]);
    setLive([]);
    setExplanations({});
    setExplainState({});
    autoAsked.current.clear();
    setOpenTerm(null);
    setAiState({ state: "idle" });
    setLiveState({ busy: false });
    setViewing(null);
    setShowSettings(false);
    lastLangRef.current = undefined;
  };

  let aiStatus: { text: string; error: boolean } | null = null;
  if (!aiOn) {
    aiStatus = { text: "已關閉 · Off", error: false };
  } else if (aiState.state === "busy") {
    aiStatus = { text: "分析中…", error: false };
  } else if (aiState.state === "error") {
    aiStatus = { text: aiState.message, error: true };
  } else if (aiState.state === "done" && analysis) {
    const u = analysis.usage;
    aiStatus = {
      text: `上次分析 ${clockTime(aiState.at)} · ${(aiState.ms / 1000).toFixed(1)}s · in ${u.inputTokens} (cached ${u.cachedInputTokens}) / out ${u.outputTokens}`,
      error: false,
    };
  }

  if (showHistory) {
    return (
      <div className="app">
        <HistoryView
          entries={listHistory()}
          currentId={convId}
          onOpen={(id) => {
            setShowHistory(false);
            setOpenTerm(null);
            if (id === convId) return setViewing(null);
            setViewing(loadConversation(id));
          }}
          onDelete={(id) => {
            deleteConversation(id);
            setHistoryRev((n) => n + 1);
          }}
          onClose={() => setShowHistory(false)}
        />
      </div>
    );
  }

  const lastLive = shown.live.at(-1);
  const viewingLabel = viewing
    ? `${new Date(viewing.startedAt).toLocaleDateString("zh-TW")} ${clockTime(viewing.startedAt).slice(0, 5)}${
        viewing.live.at(-1)?.title ? ` · ${viewing.live.at(-1)!.title}` : ""
      }`
    : "";

  return (
    <div className="app">
      <TopBar
        status={status}
        elapsedMs={recordStartedAt === null ? 0 : now - recordStartedAt}
        recording={recording}
        busy={busy}
        blocked={passcode ? null : "請先到 ⚙ 設定輸入通關密碼"}
        error={error}
        notice={notice}
        onToggle={() => void (recording ? stop() : start())}
        onHistory={() => setShowHistory(true)}
        onSettings={() => setShowSettings(true)}
        viewing={viewing ? { label: viewingLabel, onBack: () => (setViewing(null), setOpenTerm(null)) } : null}
      />
      <TranscriptView
        state={shownState}
        units={units}
        notes={unitMarks}
        terms={shown.terms}
        openTerm={openTerm}
        onTerm={openTermCard}
        placeholder={viewing ? "這段對話沒有內容" : "按下錄音開始聽 · Tap Record to start"}
      />
      {(aiOn || viewing) && (
        <LiveDock
          ready={!viewing && canAsk}
          note={lastLive}
          busy={!viewing && liveState.busy}
          error={viewing ? undefined : liveState.error}
          seconds={liveSeconds}
          onRefresh={() => liveScheduler.runNow()}
          terms={termsNewestFirst}
          canAsk={canAsk}
          onBrief={openBrief}
          answered={new Set(Object.keys(shown.explanations))}
          loading={new Set(Object.keys(explainState).filter((k) => explainState[k]?.busy))}
          openKey={openTerm}
          onTerm={openTermCard}
          card={(() => {
            const brief = briefOf(openTerm);
            if (brief) {
              const key = BRIEF_KEY[brief];
              return (
                <InfoCard
                  label="Luna"
                  title={BRIEF_TITLE[brief]}
                  explanation={shown.explanations[key]}
                  state={explainState[key]}
                  canAsk={canAsk}
                  onAsk={() => void explain(key)}
                  onClose={() => setOpenTerm(null)}
                />
              );
            }
            if (!openTermObj) return null;
            return (
              <InfoCard
                label={KIND_LABEL[openTermObj.kind]}
                title={openTermObj.name}
                zh={openTermObj.zh}
                gist={openTermObj.kind === "question" ? undefined : openTermObj.gist}
                avatar={openTermObj.kind === "person" ? <Avatar term={openTermObj} size="lg" /> : undefined}
                photo={openTermObj.photo}
                explanation={shown.explanations[openTermObj.key]}
                state={explainState[openTermObj.key]}
                canAsk={canAsk}
                onAsk={() => void explain(openTermObj.key)}
                onClose={() => setOpenTerm(null)}
              />
            );
          })()}
        />
      )}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          passcode={passcode}
          onPasscode={(v) => {
            setPasscode(v);
            saveSetting(PASSCODE_KEY, v);
          }}
          recording={recording}
          lang={lang}
          onLang={(v) => {
            setLang(v);
            saveSetting(LANG_KEY, v);
          }}
          aiOn={aiOn}
          onAiOn={(v) => {
            setAiOn(v);
            saveSetting(AI_ON_KEY, v ? "1" : "0");
          }}
          ai={ai}
          onAi={(v) => {
            setAi(v);
            saveSetting(AI_KEY, v);
          }}
          liveSeconds={liveSeconds}
          onLiveSeconds={(v) => {
            setLiveSeconds(v);
            saveSetting(LIVE_KEY, String(v));
          }}
          context={context}
          onContext={(v) => {
            setContext(v);
            saveSetting(CONTEXT_KEY, v);
          }}
          keyterms={keyterms}
          onKeyterms={(v) => {
            setKeyterms(v);
            saveSetting(KEYTERMS_KEY, v);
          }}
          keytermCount={parseKeyterms(keyterms).length}
          aiStatus={aiStatus}
          billing={analysis?.billing ?? null}
          canStartNew={!recording && transcript.segments.length > 0}
          onNewConversation={newConversation}
        />
      )}
    </div>
  );
}
