// Shared data model (docs/PLAN.md).

import type { AnalyzeResult, LiveOutput, Source, TermResult } from "../server/llm/types.ts";
import type { LangPreset } from "./config.ts";

export type Word = { text: string; startMs: number; endMs: number }; // absolute epoch ms

export type Segment = {
  id: string; // uuid
  sessionId: string; // ElevenLabs session (changes on reconnect)
  lang?: string; // from language_code
  textRaw: string; // exactly as returned by the service
  text: string; // display text (Traditional Chinese if zh)
  words: Word[];
  startMs: number;
  endMs: number;
};

/**
 * A clause inside a segment. Segments are split into units at punctuation
 * (src/lib/units.ts), so key points can cover part of a segment or span several.
 */
export type UnitRef = { segmentId: string; unit: number };

/** A Wikipedia thumbnail for a person. */
export type Photo = { thumb: string; title: string; url: string };

/** A term worth explaining, highlighted wherever one of its mentions appears. */
export type Term = TermResult & {
  /** Lowercased name; terms with the same key are merged. */
  key: string;
  firstSeen: number;
  /** undefined = not looked up yet; null = no photo found. */
  photo?: Photo | null;
};

/** Luna's longer explanation of a term, kept so reopening it is instant. */
export type Explanation = { lines: string[]; sources: Source[]; searched: boolean; at: number };

/** One refresh of the live panel. */
export type LiveNote = LiveOutput & { at: number };

/** Everything kept for one conversation, saved on this device. */
export type Conversation = {
  id: string;
  startedAt: number;
  updatedAt: number;
  lang: LangPreset;
  segments: Segment[];
  analysis: AnalyzeResult | null;
  terms: Term[];
  /** Newest last. */
  live: LiveNote[];
  explanations: Record<string, Explanation>;
};
