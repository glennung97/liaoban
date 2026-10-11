import type { VercelRequest, VercelResponse } from "@vercel/node";
import { live, pickProvider, providerConfigured } from "../server/llm/index.js";
import { guard, llmError, TranscriptBody } from "../server/request.js";

// POST { context, segments, conversationId, lang?, provider? } → the live panel:
// title, what's being discussed now, a short recap and things to say next.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res)) return;

  const parsed = TranscriptBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request" });
  const { provider: requested, ...input } = parsed.data;

  const provider = pickProvider(requested);
  if (!providerConfigured(provider)) return res.status(500).json({ error: "provider_not_configured", provider });

  const started = Date.now();
  try {
    const result = await live(provider, input);
    return res.status(200).json({ ...result, ms: Date.now() - started });
  } catch (e) {
    return llmError(res, "live", provider, e);
  }
}
