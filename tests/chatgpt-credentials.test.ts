import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved: unknown[] = [];
vi.mock("../server/chatgpt/store.js", () => ({
  storeConfigured: () => process.env.KV_REST_API_URL !== "",
  saveCredentials: vi.fn(async (c: unknown) => void saved.push(c)),
  deleteCredentials: vi.fn(async () => {}),
  chatgptStatus: vi.fn(async () => ({ connected: true, email: "me@x.y" })),
}));
const { default: handler } = await import("../api/chatgpt-credentials.ts");

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: () => res,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

async function call(method: string, body?: unknown, passcode = "letmein") {
  const res = fakeRes();
  await handler({ method, headers: { "x-app-passcode": passcode }, body } as unknown as VercelRequest, res as unknown as VercelResponse);
  return res;
}

const good = { clientId: "oaiapp_1", accessToken: "a", refreshToken: "r", expiresAt: 1, model: "gpt-6-luna", extra: "dropped" };

describe("api/chatgpt-credentials", () => {
  beforeEach(() => {
    saved.length = 0;
    vi.stubEnv("APP_PASSCODE", "letmein");
    vi.stubEnv("KV_REST_API_URL", "https://kv");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requires the passcode", async () => {
    expect((await call("GET", undefined, "wrong")).statusCode).toBe(401);
    expect((await call("POST", { credentials: good }, "wrong")).statusCode).toBe(401);
    expect(saved).toHaveLength(0);
  });

  it("stores valid credentials (known fields only) and returns the status without tokens", async () => {
    const res = await call("POST", { credentials: good });
    expect(res.statusCode).toBe(200);
    expect(saved[0]).toEqual({ clientId: "oaiapp_1", accessToken: "a", refreshToken: "r", expiresAt: 1, model: "gpt-6-luna" });
    expect(res.body).toEqual({ connected: true, email: "me@x.y" });
  });

  it("rejects malformed credentials and says when Redis is missing", async () => {
    expect((await call("POST", { credentials: { clientId: "x" } })).statusCode).toBe(400);
    vi.stubEnv("KV_REST_API_URL", "");
    expect((await call("GET")).body).toEqual({ error: "store_not_configured" });
  });
});
