import type { Segment, Word } from "../types.ts";

/** Word shape from ElevenLabs `committed_transcript_with_timestamps`. Times are seconds. */
export type RawWord = {
  text: string;
  start?: number;
  end?: number;
  type: "word" | "spacing" | "audio_event";
};

export type TranscriptState = {
  segments: Segment[];
  /** Display text of the current partial (already converted). */
  partial: string;
  /** Index in `partial` where the newest characters start. */
  freshFrom: number;
  /** Bumped on every partial change, so the UI can restart the highlight fade. */
  partialRev: number;
};

export const emptyTranscript: TranscriptState = { segments: [], partial: "", freshFrom: 0, partialRev: 0 };

/**
 * Where the new characters of `next` start, compared with `prev`.
 * Compares by character (Chinese has no spaces) and by code point (so emoji or
 * rare CJK characters outside the BMP aren't split). If the service revises
 * earlier words, the fresh part starts at the first changed character.
 * Returns an index into `next` in UTF-16 units, usable with `slice`.
 */
export function newestChars(prevPartial: string, nextPartial: string): number {
  const a = [...prevPartial];
  const b = [...nextPartial];
  let i = 0;
  let units = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    units += b[i]!.length;
    i++;
  }
  return units;
}

export function setPartial(state: TranscriptState, next: string): TranscriptState {
  if (next === state.partial) return state;
  return { ...state, partial: next, freshFrom: newestChars(state.partial, next), partialRev: state.partialRev + 1 };
}

export function addSegment(state: TranscriptState, segment: Segment): TranscriptState {
  return { segments: [...state.segments, segment], partial: "", freshFrom: 0, partialRev: state.partialRev + 1 };
}

/**
 * Converts ElevenLabs word timings (seconds since the session's time origin)
 * to absolute epoch ms, using the wall-clock time recorded at `session_started`.
 * Spacing tokens are dropped. A word without timing borrows the previous word's
 * end (or the session origin) so the list stays ordered.
 */
export function toAbsoluteWords(words: readonly RawWord[], originMs: number): Word[] {
  const out: Word[] = [];
  let lastEnd = originMs;
  for (const w of words) {
    if (w.type === "spacing") continue;
    const startMs = w.start !== undefined ? Math.round(originMs + w.start * 1000) : lastEnd;
    const endMs = w.end !== undefined ? Math.round(originMs + w.end * 1000) : startMs;
    out.push({ text: w.text, startMs, endMs });
    lastEnd = endMs;
  }
  return out;
}

export function buildSegment(args: {
  id: string;
  sessionId: string;
  lang?: string;
  textRaw: string;
  text: string;
  words: Word[];
  fallbackMs: number;
}): Segment {
  const { words, fallbackMs } = args;
  const startMs = words[0]?.startMs ?? fallbackMs;
  const endMs = words[words.length - 1]?.endMs ?? fallbackMs;
  const seg: Segment = {
    id: args.id,
    sessionId: args.sessionId,
    textRaw: args.textRaw,
    text: args.text,
    words,
    startMs,
    endMs,
  };
  if (args.lang) seg.lang = args.lang;
  return seg;
}

/** Tail of the committed transcript, for `previousText` when reconnecting. */
export function tailText(segments: readonly Segment[], maxChars: number): string {
  const joined = segments.map((s) => s.textRaw).join(" ");
  const chars = [...joined];
  return chars.slice(Math.max(0, chars.length - maxChars)).join("");
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function toTxt(segments: readonly Segment[]): string {
  return segments.map((s) => `[${clockTime(s.startMs)}] ${s.text}`).join("\n") + "\n";
}
