import type { VercelRequest } from "@vercel/node";
import { createHash, timingSafeEqual } from "node:crypto";

// Temporary gate until real login (Phase 4).

function sameSecret(given: string, expected: string): boolean {
  // Hash both so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export type PasscodeCheck = "ok" | "not_configured" | "bad_passcode";

export function checkPasscode(req: VercelRequest): PasscodeCheck {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return "not_configured";
  const given = req.headers["x-app-passcode"];
  return typeof given === "string" && sameSecret(given, passcode) ? "ok" : "bad_passcode";
}
