import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkPasscode } from "../server/auth.js";

// Returns a single-use ElevenLabs Scribe realtime token (valid 15 minutes).
// ELEVENLABS_API_KEY stays on the server; the browser only ever sees the token.
const TOKEN_URL = "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const auth = checkPasscode(req);
  if (auth === "not_configured" || !apiKey) {
    return res.status(500).json({ error: "server_not_configured" });
  }
  if (auth === "bad_passcode") {
    return res.status(401).json({ error: "bad_passcode" });
  }

  let upstream: Response;
  try {
    upstream = await fetch(TOKEN_URL, { method: "POST", headers: { "xi-api-key": apiKey } });
  } catch {
    return res.status(502).json({ error: "elevenlabs_unreachable" });
  }

  if (!upstream.ok) {
    // Pass the status through but not the body, which could echo account details.
    return res.status(502).json({ error: "elevenlabs_error", status: upstream.status });
  }

  const data = (await upstream.json()) as { token?: unknown };
  if (typeof data.token !== "string") {
    return res.status(502).json({ error: "elevenlabs_bad_response" });
  }
  return res.status(200).json({ token: data.token });
}
