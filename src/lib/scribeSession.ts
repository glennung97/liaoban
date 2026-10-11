import { CommitStrategy, RealtimeEvents, Scribe, type RealtimeConnection } from "@elevenlabs/client";
import { MODEL_ID, validKeyterms, type LangConfig } from "../config.ts";
import type { RawWord } from "./transcript.ts";

export type SessionStatus = "idle" | "connecting" | "live" | "reconnecting" | "error";

export type Committed = {
  sessionId: string;
  /** Wall-clock ms when the first audio sample was captured; word seconds are added to this. */
  originMs: number;
  text: string;
  lang?: string;
  words: RawWord[];
};

export type SessionCallbacks = {
  onStatus(status: SessionStatus): void;
  onPartial(text: string): void;
  onCommitted(c: Committed): void;
  /** Called before a reconnect, so the UI can keep any uncommitted partial. */
  onReconnecting(reason: string): void;
  /** `fatal` errors end the session; others are informational. */
  onError(message: string, fatal: boolean): void;
};

export type SessionOptions = {
  getToken(): Promise<string>;
  /** Last ~200 chars of committed text, sent as context after a reconnect. */
  getPreviousText(): string;
  /** The user's keyterms; read at each (re)connect. */
  getKeyterms(): string[];
  /** Language preset; read at each (re)connect. */
  getLanguage(): LangConfig;
};

export class TokenError extends Error {
  constructor(
    message: string,
    readonly fatal: boolean,
  ) {
    super(message);
  }
}

/** Fetches a single-use token from our Vercel function. */
export async function fetchScribeToken(passcode: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/scribe-token", { method: "POST", headers: { "x-app-passcode": passcode } });
  } catch {
    throw new TokenError("Network error while getting a token", false);
  }
  if (res.status === 401) throw new TokenError("Wrong passcode", true);
  if (res.status === 500) throw new TokenError("Server not configured (check Vercel env vars)", true);
  if (!res.ok) throw new TokenError(`Token request failed (${res.status})`, false);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new TokenError("Token missing in response", false);
  return data.token;
}

// Errors that won't fix themselves by reconnecting.
const FATAL = new Set(["auth_error", "quota_exceeded", "unaccepted_terms", "invalid_request"]);
const FATAL_LABEL: Record<string, string> = {
  auth_error: "ElevenLabs rejected the token (auth_error)",
  quota_exceeded: "ElevenLabs quota exceeded",
  unaccepted_terms: "Accept the ElevenLabs terms in your account first",
  invalid_request: "ElevenLabs rejected the session settings",
};

/** Duration of a base64-encoded 16 kHz 16-bit mono PCM chunk. */
export function pcmChunkMs(audioBase64: string): number {
  const padding = audioBase64.endsWith("==") ? 2 : audioBase64.endsWith("=") ? 1 : 0;
  const bytes = (audioBase64.length * 3) / 4 - padding;
  return bytes / 32; // 16000 samples/s × 2 bytes = 32 bytes per ms
}

const MAX_FAILED_ATTEMPTS = 5;
const STOP_FLUSH_MS = 1500;

/**
 * One recording run. May span several ElevenLabs sessions: it reconnects with a
 * fresh token when the service ends the session (time limit) or the socket drops.
 * Billing runs only while a connection is open; `stop()` closes it.
 */
export class ScribeSession {
  private conn: RealtimeConnection | null = null;
  private gen = 0;
  private stopping = false;
  private failedAttempts = 0;
  private sessionId = "";
  private originMs = 0;
  private hasPartial = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private flushWaiter: (() => void) | null = null;

  constructor(
    private readonly opts: SessionOptions,
    private readonly cb: SessionCallbacks,
  ) {}

  /**
   * Call from the Record button's click handler. Asking for the mic here, inside
   * the user gesture, gives a clear permission error and helps iOS Safari.
   */
  async start(): Promise<void> {
    this.stopping = false;
    this.failedAttempts = 0;
    this.cb.onStatus("connecting");
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of probe.getTracks()) t.stop();
    } catch (e) {
      this.fail(`Microphone unavailable: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    await this.connect(false);
  }

  /** Asks the service to commit the pending partial, waits briefly, then closes. */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    clearTimeout(this.retryTimer);
    const conn = this.conn;
    if (conn && this.hasPartial) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, STOP_FLUSH_MS);
        this.flushWaiter = () => {
          clearTimeout(timer);
          resolve();
        };
        try {
          conn.commit();
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
      this.flushWaiter = null;
    }
    this.closeCurrent();
    this.cb.onStatus("idle");
  }

  private closeCurrent() {
    this.gen++; // ignore any late events from the old connection
    const conn = this.conn;
    this.conn = null;
    this.hasPartial = false;
    try {
      conn?.close();
    } catch {
      // already closed
    }
  }

  private fail(message: string) {
    this.stopping = true;
    clearTimeout(this.retryTimer);
    this.closeCurrent();
    this.cb.onError(message, true);
    this.cb.onStatus("error");
  }

  private scheduleReconnect(reason: string) {
    if (this.stopping) return;
    this.closeCurrent();
    this.cb.onReconnecting(reason);
    this.cb.onStatus("reconnecting");
    if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      this.fail(`Gave up after ${MAX_FAILED_ATTEMPTS} failed reconnects (${reason})`);
      return;
    }
    // First retry is immediate (time-limit case); later ones back off.
    const delay = this.failedAttempts === 0 ? 0 : Math.min(500 * 2 ** this.failedAttempts, 8000);
    this.failedAttempts++;
    this.retryTimer = setTimeout(() => void this.connect(true), delay);
  }

  private async connect(isReconnect: boolean): Promise<void> {
    let token: string;
    try {
      token = await this.opts.getToken();
    } catch (e) {
      if (e instanceof TokenError && e.fatal) return this.fail(e.message);
      this.cb.onError(e instanceof Error ? e.message : String(e), false);
      return this.scheduleReconnect("token request failed");
    }
    if (this.stopping) return;

    const previousText = isReconnect ? this.opts.getPreviousText() : "";
    const lang = this.opts.getLanguage();
    // The user's terms first, so the preset's never push them past the limit of 50.
    const keyterms = validKeyterms([...this.opts.getKeyterms(), ...lang.keyterms]);
    const gen = ++this.gen;
    const conn = Scribe.connect({
      token,
      modelId: MODEL_ID,
      commitStrategy: CommitStrategy.VAD,
      includeTimestamps: true,
      includeLanguageDetection: true,
      ...(lang.primary ? { languageCode: lang.primary } : {}),
      ...(lang.secondary.length ? { secondaryLanguages: [...lang.secondary] } : {}),
      ...(keyterms.length ? { keyterms } : {}),
      ...(previousText ? { previousText } : {}),
      microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.conn = conn;
    const live = () => gen === this.gen;

    // Word timestamps count from the first audio sent, not from session_started
    // (measured 2026-10-11: a word 1.51 s into the audio came back as start=1.6,
    // while session_started was 1 s earlier). The SDK starts the mic only after
    // the socket opens, so record when the first chunk goes out and subtract its
    // length to get the moment that audio was captured.
    this.originMs = 0;
    const send = conn.send.bind(conn);
    conn.send = (data) => {
      if (live() && this.originMs === 0) this.originMs = Date.now() - pcmChunkMs(data.audioBase64);
      send(data);
    };

    conn.on(RealtimeEvents.SESSION_STARTED, (m) => {
      if (!live()) return;
      this.sessionId = m.session_id;
      this.failedAttempts = 0;
      this.cb.onStatus("live");
    });

    conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (m) => {
      if (!live()) return;
      this.hasPartial = m.text.length > 0;
      this.cb.onPartial(m.text);
    });

    conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS, (m) => {
      if (!live()) return;
      this.hasPartial = false;
      if (m.text.trim()) {
        const c: Committed = {
          sessionId: this.sessionId,
          originMs: this.originMs || Date.now(), // fallback if no chunk was recorded
          text: m.text,
          words: m.words ?? [],
        };
        if (m.language_code) c.lang = m.language_code;
        this.cb.onCommitted(c);
      }
      this.flushWaiter?.();
    });

    conn.on(RealtimeEvents.SESSION_TIME_LIMIT_EXCEEDED, () => {
      if (!live()) return;
      this.scheduleReconnect("session time limit");
    });

    conn.on(RealtimeEvents.ERROR, (m) => {
      if (!live() || this.stopping) return;
      if (FATAL.has(m.message_type)) return this.fail(`${FATAL_LABEL[m.message_type]}: ${m.error}`);
      if (m.message_type === "session_time_limit_exceeded") return; // handled above
      if (m.message_type === "insufficient_audio_activity") return; // silence; not worth showing
      this.cb.onError(`${m.message_type}: ${m.error}`, false);
    });

    conn.on(RealtimeEvents.CLOSE, (ev) => {
      if (!live() || this.stopping) return;
      this.scheduleReconnect(`connection closed (${ev.code})`);
    });
  }
}
