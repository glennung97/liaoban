import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { checkPasscode } from "./auth.js";
import { LANGS } from "./llm/types.js";

// Shared by api/analyze.ts, api/live.ts and api/explain.ts.
export const TranscriptBody = z.object({
  context: z.string().max(4000).default(""),
  segments: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        units: z.array(z.string().max(2000)).min(1).max(300),
        at: z.string().max(16).optional(),
      }),
    )
    .min(1)
    .max(3000),
  conversationId: z.string().min(1).max(100),
  lang: z.enum(LANGS).optional(),
  provider: z.string().optional(),
});

/** POST + passcode check. Returns false after sending an error response. */
export function guard(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return false;
  }
  const auth = checkPasscode(req);
  if (auth === "not_configured") {
    res.status(500).json({ error: "server_not_configured" });
    return false;
  }
  if (auth === "bad_passcode") {
    res.status(401).json({ error: "bad_passcode" });
    return false;
  }
  return true;
}

/** Logs the detail for Vercel's logs; the client only needs to know it failed. */
export function llmError(res: VercelResponse, label: string, provider: string, e: unknown) {
  console.error(`${label} failed (${provider})`, e);
  const status = typeof e === "object" && e !== null && "status" in e ? Number(e.status) : undefined;
  return res.status(502).json({ error: "llm_error", provider, status });
}
