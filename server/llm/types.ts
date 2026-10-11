import { z } from "zod";

// Shared by both providers. The transcript is sent as clause-sized units (split
// at punctuation by the client) with short IDs u1, u2, … in order. Key points
// come back as unit ranges; normalize.ts maps them to { segmentId, unit }.

/**
 * What a highlighted term is; people get a photo, topics get the news behind them,
 * and questions (something the speakers wonder about) get answered by a web search.
 */
export const TERM_KINDS = ["person", "topic", "place", "org", "slang", "question", "other"] as const;
export type TermKind = (typeof TERM_KINDS)[number];

export const AnalyzeOutputSchema = z.object({
  highlights: z.array(
    z.object({
      from: z.string().describe("First unit of the key passage, e.g. u12"),
      to: z.string().describe("Last unit of the key passage (same as from for a single unit)"),
      importance: z.number().int().describe("1 = useful, 2 = important, 3 = must know"),
      reason: z.string().describe("Short reason in Traditional Chinese"),
    }),
  ),
  terms: z.array(
    z.object({
      name: z
        .string()
        .describe("People, places, organisations and slang in their original spelling (e.g. 'Gibran Rakabuming Raka'); topics and questions in short Traditional Chinese"),
      zh: z
        .string()
        .describe("The usual Traditional Chinese (Taiwan) name or translation, e.g. '吉布蘭'; empty if name is already Chinese or there is none"),
      kind: z.enum(TERM_KINDS),
      mentions: z.array(z.string()).describe("The exact words in the transcript that refer to it, as written there"),
      gist: z.string().describe("One short line in Traditional Chinese: who or what it is"),
      wiki: z.string().describe("Wikipedia article title for a person, place or organisation; empty otherwise"),
    }),
  ),
});
export type AnalyzeOutput = z.infer<typeof AnalyzeOutputSchema>;

export const LiveOutputSchema = z.object({
  title: z.string().describe("A 4–12 character title for the conversation so far, in Traditional Chinese"),
  now: z.string().describe("One line: what is being talked about right now"),
  points: z.array(z.string()).describe("0–3 short recap lines in Traditional Chinese"),
  questions: z.array(
    z.object({
      angle: z.string().describe("2–4 character label in Traditional Chinese, e.g. 追問, 換個方向, 回應"),
      say: z.string().describe("What the user could say, in the language and register the speakers use"),
      meaning: z.string().describe("Traditional Chinese translation; empty if `say` is already Chinese"),
    }),
  ),
});
export type LiveOutput = z.infer<typeof LiveOutputSchema>;

export const PROVIDERS = ["openai", "anthropic"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** How hard the model thinks. Conversations need quick answers, so calls use "low". */
export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Language preset of the conversation; also where to localise web searches. */
export const LANGS = ["zh", "id", "nl", "auto"] as const;
export type Lang = (typeof LANGS)[number];

/** A clause inside a segment: `unit` is its index in the segment's units. */
export type UnitRef = { segmentId: string; unit: number };

export type TranscriptInput = {
  /** Who the user is and what the conversation is (optional, typed by the user). */
  context: string;
  /** Chronological and append-only, so the prompt prefix stays cacheable. `at` is the local clock time. */
  segments: { id: string; units: string[]; at?: string }[];
  /** Stable per transcript; used as OpenAI's prompt_cache_key. */
  conversationId: string;
  lang?: Lang;
};

export type Usage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

/** One structured call, provider-neutral. `task` comes after the transcript so the prefix caches. */
export type StructuredRequest<S extends z.ZodType> = {
  system: string;
  transcript: string;
  task?: string;
  schema: S;
  name: string;
  cacheKey: string;
  effort: Effort;
};

/** Who paid for a call: the owner's ChatGPT plan, or an API key. */
export type Billing = "chatgpt" | "api_key";

export type StructuredResult<T> = { output: T; model: string; usage: Usage; billing: Billing };

/** The two on-demand summaries next to the live panel. */
export const BRIEF_KINDS = ["overview", "background"] as const;
export type BriefKind = (typeof BRIEF_KINDS)[number];

/** A free-text call that may search the web first. */
export type SearchRequest = {
  system: string;
  transcript: string;
  task: string;
  cacheKey: string;
  /** ISO country code to localise results, e.g. "ID". */
  country?: string;
};

export type Source = { title: string; url: string };

export type SearchResult = { text: string; sources: Source[]; searched: boolean; model: string; usage: Usage; billing: Billing };

export type HighlightResult = { from: UnitRef; to: UnitRef; importance: 1 | 2 | 3; reason: string };

export type TermResult = { name: string; zh: string; kind: TermKind; mentions: string[]; gist: string; wiki: string };

export type AnalyzeResult = {
  highlights: HighlightResult[];
  terms: TermResult[];
  provider: Provider;
  model: string;
  usage: Usage;
  billing: Billing;
  /** How many segments this result covers. */
  segmentCount: number;
  /** Request duration, added by api/analyze.ts. */
  ms?: number;
};

export type LiveResult = LiveOutput & { provider: Provider; model: string; usage: Usage; billing: Billing; ms?: number };

export type ExplainResult = {
  lines: string[];
  sources: Source[];
  /** Whether the model actually searched the web (otherwise it answered from memory). */
  searched: boolean;
  provider: Provider;
  model: string;
  usage: Usage;
  billing: Billing;
  ms?: number;
};
