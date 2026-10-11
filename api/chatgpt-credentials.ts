import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { checkPasscode } from "../server/auth.js";
import { isCredentials } from "../server/chatgpt/oauth.js";
import { chatgptStatus, deleteCredentials, saveCredentials, storeConfigured } from "../server/chatgpt/store.js";

// The owner's ChatGPT plan connection (see scripts/chatgpt-login.ts).
// GET → status (never tokens); POST { credentials } → store them; DELETE → disconnect.
const Body = z.object({ credentials: z.unknown() });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const auth = checkPasscode(req);
  if (auth === "not_configured") return res.status(500).json({ error: "server_not_configured" });
  if (auth === "bad_passcode") return res.status(401).json({ error: "bad_passcode" });
  if (!storeConfigured()) return res.status(500).json({ error: "store_not_configured" });

  try {
    if (req.method === "GET") return res.status(200).json(await chatgptStatus());
    if (req.method === "DELETE") {
      await deleteCredentials();
      return res.status(200).json(await chatgptStatus());
    }
    const parsed = Body.safeParse(req.body);
    if (!parsed.success || !isCredentials(parsed.data.credentials)) return res.status(400).json({ error: "bad_credentials" });
    const c = parsed.data.credentials;
    await saveCredentials({
      clientId: c.clientId,
      accessToken: c.accessToken,
      refreshToken: c.refreshToken,
      expiresAt: c.expiresAt,
      ...(c.idToken ? { idToken: c.idToken } : {}),
      ...(c.email ? { email: c.email } : {}),
      ...(c.model ? { model: c.model } : {}),
    });
    return res.status(200).json(await chatgptStatus());
  } catch (e) {
    console.error("chatgpt-credentials failed", e);
    return res.status(502).json({ error: "store_error" });
  }
}
