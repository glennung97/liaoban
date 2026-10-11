import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { SearchRequest, SearchResult, Source, StructuredRequest, StructuredResult, Usage } from "./types.js";

// Alternative provider: $0.10 / $0.50 per 1M tokens for prompts up to 100K tokens.
export const ANTHROPIC_MODEL = "claude-haiku-5-5";

let client: Anthropic | undefined;
const getClient = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY

function usageOf(u: Anthropic.Usage): Usage {
  const cached = u.cache_read_input_tokens ?? 0;
  return {
    // Anthropic reports uncached, cache-write and cache-read input separately.
    inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + cached,
    cachedInputTokens: cached,
    outputTokens: u.output_tokens,
  };
}

// Cache up to the end of the transcript; the task after it varies.
function userContent(transcript: string, task?: string): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: transcript, cache_control: { type: "ephemeral" } },
    ...(task ? [{ type: "text" as const, text: task }] : []),
  ];
}

function checkRefusal(res: Anthropic.Message) {
  if (res.stop_reason === "refusal") {
    throw new Error(`Claude declined the request (${res.stop_details?.category ?? "no category"})`);
  }
}

export async function callAnthropic<S extends z.ZodType>(
  req: StructuredRequest<S>,
): Promise<StructuredResult<z.infer<S>>> {
  const res = await getClient().messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 16000,
    system: req.system,
    messages: [{ role: "user", content: userContent(req.transcript, req.task) }],
    output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
  });
  checkRefusal(res);
  if (!res.parsed_output) throw new Error(`Claude returned no parsable output (stop_reason: ${res.stop_reason})`);
  return { output: res.parsed_output as z.infer<S>, model: res.model, usage: usageOf(res.usage), billing: "api_key" };
}

/** Free text, with Anthropic's web search tool; falls back to no search if the tool is rejected (400). */
export async function searchAnthropic(req: SearchRequest): Promise<SearchResult> {
  const run = (withSearch: boolean) =>
    getClient().messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 4000,
      system: req.system,
      messages: [{ role: "user", content: userContent(req.transcript, req.task) }],
      output_config: { effort: "low" },
      ...(withSearch
        ? {
            tools: [
              {
                type: "web_search_20250305" as const,
                name: "web_search" as const,
                max_uses: 3,
                ...(req.country ? { user_location: { type: "approximate" as const, country: req.country } } : {}),
              },
            ],
          }
        : {}),
    });

  let res: Anthropic.Message;
  try {
    res = await run(true);
  } catch (e) {
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    console.warn("web search rejected; answering without it", e.message);
    res = await run(false);
  }
  checkRefusal(res);

  let text = "";
  const sources: Source[] = [];
  for (const block of res.content) {
    if (block.type !== "text") continue;
    text += block.text;
    for (const c of block.citations ?? []) {
      if (c.type === "web_search_result_location") sources.push({ title: c.title ?? "", url: c.url });
    }
  }
  return {
    text,
    sources,
    searched: res.content.some((b) => b.type === "server_tool_use"),
    model: res.model,
    usage: usageOf(res.usage),
    billing: "api_key",
  };
}
