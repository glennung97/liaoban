import type { z } from "zod";
import { callAnthropic, searchAnthropic } from "./anthropic.js";
import { explanationLines, normalizeHighlights, normalizeLive, normalizeTerms, uniqueSources } from "./normalize.js";
import { callOpenAI, openaiConfigured, searchOpenAI } from "./openai.js";
import {
  analyzeSystemPrompt,
  analyzeTask,
  briefTask,
  explainSystemPrompt,
  explainTask,
  liveSystemPrompt,
  liveTask,
  plainTranscript,
  unitTranscript,
} from "./prompt.js";
import {
  AnalyzeOutputSchema,
  LiveOutputSchema,
  PROVIDERS,
  type AnalyzeResult,
  type BriefKind,
  type ExplainResult,
  type Lang,
  type LiveResult,
  type Provider,
  type StructuredRequest,
  type StructuredResult,
  type TermKind,
  type TranscriptInput,
} from "./types.js";

function call<S extends z.ZodType>(provider: Provider, req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  return provider === "anthropic" ? callAnthropic(req) : callOpenAI(req);
}


export function isProvider(v: unknown): v is Provider {
  return typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);
}

/** Per-request choice, else LLM_PROVIDER, else OpenAI. */
export function pickProvider(requested: unknown): Provider {
  if (isProvider(requested)) return requested;
  const env = process.env.LLM_PROVIDER;
  return isProvider(env) ? env : "openai";
}

export function providerConfigured(p: Provider): boolean {
  return p === "openai" ? openaiConfigured() : Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Key points as unit ranges, plus terms worth explaining from the newest part. */
export async function analyze(provider: Provider, input: TranscriptInput): Promise<AnalyzeResult> {
  const unitCount = input.segments.reduce((n, s) => n + s.units.length, 0);
  const { output, model, usage, billing } = await call(provider, {
    system: analyzeSystemPrompt(input.context),
    transcript: unitTranscript(input.segments),
    task: analyzeTask(unitCount),
    schema: AnalyzeOutputSchema,
    name: "key_points",
    cacheKey: `liaoban:hl:${input.conversationId}`,
    effort: "low",
  });
  return {
    highlights: normalizeHighlights(output.highlights, input.segments),
    terms: normalizeTerms(output.terms),
    provider,
    model,
    usage,
    billing,
    segmentCount: input.segments.length,
  };
}

/** The live panel: what's being discussed, a short recap and things to say next. */
export async function live(provider: Provider, input: TranscriptInput): Promise<LiveResult> {
  const { output, model, usage, billing } = await call(provider, {
    system: liveSystemPrompt(input.context),
    transcript: plainTranscript(input.segments),
    task: liveTask(),
    schema: LiveOutputSchema,
    name: "live_panel",
    cacheKey: `liaoban:live:${input.conversationId}`,
    effort: "low",
  });
  return { ...normalizeLive(output), provider, model, usage, billing };
}

const COUNTRY: Partial<Record<Lang, string>> = { id: "ID", zh: "TW", nl: "NL" };

type Explainable = { term: { name: string; kind: TermKind; mentions: string[]; gist?: string } } | { brief: BriefKind };

/**
 * Explains one term, or gives one of the two on-demand summaries (overview,
 * background), searching the web when the model decides to.
 */
export async function explain(provider: Provider, input: TranscriptInput, what: Explainable): Promise<ExplainResult> {
  const req = {
    system: explainSystemPrompt(input.context),
    transcript: plainTranscript(input.segments),
    task: "term" in what ? explainTask(what.term) : briefTask(what.brief),
    cacheKey: `liaoban:explain:${input.conversationId}`,
    ...(input.lang && COUNTRY[input.lang] ? { country: COUNTRY[input.lang] } : {}),
  };
  const r = provider === "anthropic" ? await searchAnthropic(req) : await searchOpenAI(req);
  return {
    lines: explanationLines(r.text),
    sources: uniqueSources(r.sources),
    searched: r.searched,
    provider,
    model: r.model,
    usage: r.usage,
    billing: r.billing,
  };
}
