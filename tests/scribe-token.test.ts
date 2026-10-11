import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/scribe-token.ts";

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      res.headers[k] = v;
      return res;
    },
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

function call(headers: Record<string, string> = {}, method = "POST") {
  const res = fakeRes();
  const req = { method, headers } as unknown as VercelRequest;
  return handler(req, res as unknown as VercelResponse).then(() => res);
}

describe("api/scribe-token", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("APP_PASSCODE", "letmein");
    vi.stubEnv("ELEVENLABS_API_KEY", "sk_test");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects a missing or wrong passcode without calling ElevenLabs", async () => {
    expect((await call()).statusCode).toBe(401);
    expect((await call({ "x-app-passcode": "nope" })).statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the token and keeps the API key server-side", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ token: "tok_123" }), { status: 200 }));
    const res = await call({ "x-app-passcode": "letmein" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ token: "tok_123" });
    expect(JSON.stringify(res.body)).not.toContain("sk_test");
    expect(res.headers["Cache-Control"]).toBe("no-store");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe");
    expect(init).toMatchObject({ method: "POST", headers: { "xi-api-key": "sk_test" } });
  });

  it("maps upstream failures to 502", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const res = await call({ "x-app-passcode": "letmein" });
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: "elevenlabs_error", status: 401 });
  });

  it("fails closed when env vars are missing", async () => {
    vi.stubEnv("APP_PASSCODE", "");
    expect((await call({ "x-app-passcode": "" })).statusCode).toBe(500);
  });

  it("rejects other methods", async () => {
    expect((await call({}, "DELETE")).statusCode).toBe(405);
  });
});
