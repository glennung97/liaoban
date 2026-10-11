import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { explain, pickProvider, providerConfigured } from "../server/llm/index.js";
import { BRIEF_KINDS, TERM_KINDS } from "../server/llm/types.js";
import { guard, llmError, TranscriptBody } from "../server/request.js";

// POST { term: {name, kind, mentions, gist?} | brief: "overview" | "background",
//        context, segments, conversationId, lang?, provider? }
// → a few lines on a term (who or what it is, what's happening, or the answer to a
// question), or on the whole conversation, with a web search when useful.
const Term = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(TERM_KINDS),
  mentions: z.array(z.string().max(120)).max(20).default([]),
  gist: z.string().max(500).optional(),
});
const Body = z.union([
  TranscriptBody.extend({ term: Term }),
  TranscriptBody.extend({ brief: z.enum(BRIEF_KINDS) }),
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res)) return;

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request" });
  const { provider: requested, ...rest } = parsed.data;
  const { what, input } =
    "term" in rest
      ? (({ term, ...input }) => ({ what: { term }, input }))(rest)
      : (({ brief, ...input }) => ({ what: { brief }, input }))(rest);

  const provider = pickProvider(requested);
  if (!providerConfigured(provider)) return res.status(500).json({ error: "provider_not_configured", provider });

  const started = Date.now();
  try {
    const result = await explain(provider, input, what);
    return res.status(200).json({ ...result, ms: Date.now() - started });
  } catch (e) {
    return llmError(res, "explain", provider, e);
  }
}
