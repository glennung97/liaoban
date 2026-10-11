import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { getAccess, NoCredentialsError, recordError, recordPlanUse, storeConfigured } from "../chatgpt/store.js";
import type { Billing, SearchRequest, SearchResult, Source, StructuredRequest, StructuredResult, Usage } from "./types.js";

// Default provider ("Luna"). ID and price checked on OpenAI's model page (2026-10-11):
// $0.10 / $0.50 per 1M tokens, cached input $0.01. No dated snapshot is published.
export const OPENAI_MODEL = "gpt-6-luna";

// Two ways to pay: the owner's ChatGPT plan (Sign in with ChatGPT, tokens in
// Redis; see server/chatgpt/) and, as a fallback, OPENAI_API_KEY. Plan requests
// must stream and must not be stored, so every request streams and sets
// store: false; only API-key requests send prompt_cache_key.

type Auth = { billing: Billing; client: OpenAI; model: string };

let apiKeyClient: OpenAI | undefined;

async function planAuth(): Promise<Auth | null> {
  if (!storeConfigured()) return null;
  try {
    const { token, model } = await getAccess();
    return { billing: "chatgpt", client: new OpenAI({ apiKey: token }), model: process.env.CHATGPT_MODEL || model || OPENAI_MODEL };
  } catch (e) {
    if (e instanceof NoCredentialsError) return null;
    console.warn("ChatGPT plan unavailable; using the API key", e);
    await recordError(e instanceof Error ? e.message : String(e)).catch(() => {});
    return null;
  }
}

/** Runs on the ChatGPT plan if connected; on any failure (limits, model, tokens) retries with the API key. */
async function withAuth<T>(run: (a: Auth) => Promise<T>): Promise<T & { billing: Billing }> {
  const plan = await planAuth();
  if (plan) {
    try {
      const r = await run(plan);
      void recordPlanUse().catch(() => {});
      return { ...r, billing: "chatgpt" };
    } catch (e) {
      if (!process.env.OPENAI_API_KEY) throw e;
      console.warn("ChatGPT plan request failed; retrying with the API key", e);
      await recordError(e instanceof Error ? e.message : String(e)).catch(() => {});
    }
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("No OpenAI credentials: connect the ChatGPT plan or set OPENAI_API_KEY");
  apiKeyClient ??= new OpenAI(); // reads OPENAI_API_KEY
  const r = await run({ billing: "api_key", client: apiKeyClient, model: OPENAI_MODEL });
  return { ...r, billing: "api_key" };
}

function usageOf(res: { usage?: OpenAI.Responses.ResponseUsage | null }): Usage {
  return {
    inputTokens: res.usage?.input_tokens ?? 0,
    cachedInputTokens: res.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
  };
}

// Transcript first and task last, so calls on one conversation share a cached prefix.
function inputOf(transcript: string, task?: string): OpenAI.Responses.ResponseInput {
  return [{ role: "user", content: transcript }, ...(task ? [{ role: "user" as const, content: task }] : [])];
}

const cacheKey = (a: Auth, key: string) => (a.billing === "api_key" ? { prompt_cache_key: key } : {});

export function callOpenAI<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  return withAuth(async (a) => {
    const stream = a.client.responses.stream({
      model: a.model,
      instructions: req.system,
      input: inputOf(req.transcript, req.task),
      reasoning: { effort: req.effort },
      text: { format: zodTextFormat(req.schema, req.name) },
      // Private conversations: don't keep them on OpenAI's side.
      store: false,
      ...cacheKey(a, req.cacheKey),
    });
    const res = await stream.finalResponse();
    if (!res.output_parsed) throw new Error("OpenAI returned no parsable output");
    return { output: res.output_parsed as z.infer<S>, model: res.model, usage: usageOf(res) };
  });
}

/**
 * Free text, with OpenAI's web search tool. If the tool is rejected (400; it
 * depends on the model and account), answers once more without it.
 */
export function searchOpenAI(req: SearchRequest): Promise<SearchResult> {
  return withAuth(async (a) => {
    const run = (withSearch: boolean) =>
      a.client.responses
        .stream({
          model: a.model,
          instructions: req.system,
          input: inputOf(req.transcript, req.task),
          reasoning: { effort: "low" },
          tools: withSearch
            ? [
                {
                  type: "web_search",
                  search_context_size: "low",
                  // Without a location OpenAI assumes the United States.
                  user_location: req.country ? { type: "approximate", country: req.country } : { type: "approximate" },
                },
              ]
            : [],
          store: false,
          ...cacheKey(a, req.cacheKey),
        })
        .finalResponse();

    let res: OpenAI.Responses.Response;
    try {
      res = await run(true);
    } catch (e) {
      if (!(e instanceof OpenAI.BadRequestError)) throw e;
      console.warn("web search rejected; answering without it", e.message);
      res = await run(false);
    }

    const sources: Source[] = [];
    for (const item of res.output) {
      if (item.type !== "message") continue;
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const an of part.annotations) if (an.type === "url_citation") sources.push({ title: an.title, url: an.url });
      }
    }
    return {
      text: res.output_text,
      sources,
      searched: res.output.some((o) => o.type === "web_search_call"),
      model: res.model,
      usage: usageOf(res),
    };
  });
}

/** OpenAI is usable if either the API key or the plan's token store is configured. */
export function openaiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) || storeConfigured();
}
