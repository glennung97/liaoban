import type { AnalyzeResult, UnitRef } from "../../server/llm/types.ts";
import { buildSegment } from "../lib/transcript.ts";
import { termKey } from "../lib/terms.ts";
import type { Explanation, LiveNote, Segment, Term } from "../types.ts";

// Dev-only sample conversation (load with ?demo on `npm run dev`), for working on
// the UI without a microphone or AI calls. Staged ride-hailing chat in casual
// Jakarta Indonesian; the annotations below are hand-written, not model output.
const LINES = [
  "Mas dari mana? Taiwan ya? Wah jauh juga.",
  "Iya nih, sekarang lagi rame banget soal ijazah, lo tau nggak?",
  "Itu loh, ijazahnya Pak Jokowi, katanya palsu, sampe dibawa ke pengadilan.",
  "Roy Suryo yang bilang palsu, terus UGM bilang asli. Gue sih bingung, cincai lah.",
  "Eh tapi macetnya parah ya hari ini, mau lewat tol aja?",
  "Btw lagu barunya Jason Mraz apa ya namanya? Gue lupa.",
];

export function demoSegments(): Segment[] {
  const t0 = Date.now() - LINES.length * 20000;
  return LINES.map((text, i) => {
    const start = t0 + i * 20000;
    const words = text.split(/\s+/).map((w, k) => ({ text: w, startMs: start + k * 300, endMs: start + (k + 1) * 300 }));
    return buildSegment({ id: crypto.randomUUID(), sessionId: "demo", lang: "id", textRaw: text, text, words, fallbackMs: start });
  });
}

export function demoAnalysis(segments: Segment[]): AnalyzeResult {
  const u = (seg: number, unit: number): UnitRef => ({ segmentId: segments[seg]!.id, unit });
  return {
    highlights: [
      { from: u(2, 1), to: u(2, 3), importance: 2, reason: "前總統學歷爭議" },
      { from: u(4, 1), to: u(4, 1), importance: 3, reason: "問你要不要走收費道路" },
    ],
    terms: [],
    provider: "openai",
    model: "gpt-6-luna",
    usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
    billing: "api_key",
    segmentCount: segments.length,
    ms: 0,
  };
}

export function demoTerms(): Term[] {
  const t0 = Date.now() - 60000;
  const terms: Omit<Term, "key" | "firstSeen">[] = [
    { name: "Jokowi 假學歷爭議", zh: "", kind: "topic", mentions: ["ijazah", "ijazahnya"], gist: "對前總統 Jokowi 大學畢業證書造假的指控", wiki: "" },
    { name: "Joko Widodo", zh: "佐科威", kind: "person", mentions: ["Pak Jokowi", "Jokowi"], gist: "印尼前總統（2014–2024）", wiki: "Joko Widodo" },
    { name: "Roy Suryo", zh: "羅伊·蘇約", kind: "person", mentions: ["Roy Suryo"], gist: "前青年體育部長，質疑 Jokowi 學歷的人之一", wiki: "Roy Suryo" },
    { name: "UGM", zh: "加札馬達大學", kind: "org", mentions: ["UGM"], gist: "Jokowi 的母校", wiki: "Gadjah Mada University" },
    { name: "cincai", zh: "隨便", kind: "slang", mentions: ["cincai"], gist: "福建話「凊彩」：隨便、無所謂", wiki: "" },
    { name: "Jason Mraz", zh: "傑森·瑪耶茲", kind: "person", mentions: ["Jason Mraz"], gist: "美國創作歌手", wiki: "Jason Mraz" },
    { name: "Jason Mraz 最新的歌叫什麼？", zh: "", kind: "question", mentions: ["lagu barunya"], gist: "", wiki: "" },
  ];
  return terms.map((t, i) => ({ ...t, key: termKey(t.name), firstSeen: t0 + i * 1000 }));
}

export function demoLive(): LiveNote {
  return {
    at: Date.now() - 5000,
    title: "司機聊學歷爭議",
    now: "司機在聊前總統 Jokowi 的畢業證書爭議，現在問要不要走收費道路",
    points: ["司機問你要不要走收費道路（tol）"],
    questions: [
      { angle: "回應", say: "Boleh, lewat tol aja, Pak.", meaning: "好，走收費道路吧。" },
      { angle: "請他解釋", say: "Emang kenapa sih ribut soal ijazah?", meaning: "為什麼大家在吵畢業證書的事？" },
      { angle: "換個方向", say: "Bapak udah lama jadi driver?", meaning: "您開車很久了嗎？" },
    ],
  };
}

export function demoAnswer(): Explanation {
  return {
    at: Date.now() - 2000,
    searched: false,
    sources: [],
    lines: ["（範例文字，非 AI 輸出）這裡會顯示 Luna 上網查到的答案：最可能是哪首歌、何時發行。"],
  };
}

export function demoExplanation(): Explanation {
  return {
    at: Date.now() - 3000,
    searched: false,
    sources: [],
    lines: [
      "（範例文字，非 AI 輸出）有人指控前總統 Jokowi 的加札馬達大學（UGM）畢業證書是假的，這幾年在網路和法院間反覆延燒。",
      "UGM 多次表示證書是真的；Jokowi 對散布指控的人提告。",
      "司機提到的 Roy Suryo 是主要質疑者之一，所以他才會說「有人說假、UGM 說真」。",
    ],
  };
}
