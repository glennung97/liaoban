import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyzeMock = vi.fn();
const liveMock = vi.fn();
const explainMock = vi.fn();
vi.mock("../server/llm/index.js", async (orig) => {
  const real = await orig<typeof import("../server/llm/index.ts")>();
  return { ...real, analyze: analyzeMock, live: liveMock, explain: explainMock };
});
const { default: analyzeHandler } = await import("../api/analyze.ts");
const { default: liveHandler } = await import("../api/live.ts");
const { default: explainHandler } = await import("../api/explain.ts");

type Handler = (req: VercelRequest, res: VercelResponse) => unknown;

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

const goodBody = {
  context: "",
  segments: [{ id: "a", units: ["Eh bro, ", "lo jadi ikut?"], at: "12:00:01" }],
  conversationId: "c-1",
  lang: "id",
};

async function call(
  handler: Handler,
  body: unknown,
  headers: Record<string, string> = { "x-app-passcode": "letmein" },
  method = "POST",
) {
  const res = fakeRes();
  await handler({ method, headers, body } as unknown as VercelRequest, res as unknown as VercelResponse);
  return res;
}

beforeEach(() => {
  vi.stubEnv("APP_PASSCODE", "letmein");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("LLM_PROVIDER", "");
  analyzeMock.mockReset();
  liveMock.mockReset();
  explainMock.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("api/analyze", () => {
  it("requires POST and the passcode", async () => {
    expect((await call(analyzeHandler, goodBody, {})).statusCode).toBe(401);
    expect((await call(analyzeHandler, goodBody, undefined, "GET")).statusCode).toBe(405);
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies", async () => {
    expect((await call(analyzeHandler, { segments: [] })).statusCode).toBe(400);
    expect((await call(analyzeHandler, { ...goodBody, segments: "nope" })).statusCode).toBe(400);
    expect((await call(analyzeHandler, { ...goodBody, segments: [{ id: "a", units: [] }] })).statusCode).toBe(400);
  });

  it("defaults to OpenAI and returns the result", async () => {
    analyzeMock.mockResolvedValue({ highlights: [], provider: "openai" });
    const res = await call(analyzeHandler, goodBody);
    expect(res.statusCode).toBe(200);
    expect(analyzeMock).toHaveBeenCalledWith("openai", goodBody);
    expect(res.body).toMatchObject({ provider: "openai" });
  });

  it("honours LLM_PROVIDER and the per-request choice", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    analyzeMock.mockResolvedValue({});
    await call(analyzeHandler, goodBody);
    expect(analyzeMock.mock.calls[0]![0]).toBe("anthropic");
    await call(analyzeHandler, { ...goodBody, provider: "openai" });
    expect(analyzeMock.mock.calls[1]![0]).toBe("openai");
  });

  it("says which provider is missing its key", async () => {
    const res = await call(analyzeHandler, { ...goodBody, provider: "anthropic" });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "provider_not_configured", provider: "anthropic" });
  });

  it("maps provider failures to 502 without leaking details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    analyzeMock.mockRejectedValue(Object.assign(new Error("secret detail"), { status: 429 }));
    const res = await call(analyzeHandler, goodBody);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: "llm_error", provider: "openai", status: 429 });
  });
});

describe("api/live", () => {
  it("requires the passcode and returns the panel", async () => {
    expect((await call(liveHandler, goodBody, {})).statusCode).toBe(401);
    liveMock.mockResolvedValue({ title: "閒聊", now: "", points: [], questions: [] });
    const res = await call(liveHandler, goodBody);
    expect(res.statusCode).toBe(200);
    expect(liveMock).toHaveBeenCalledWith("openai", goodBody);
  });

  it("rejects an unknown language", async () => {
    expect((await call(liveHandler, { ...goodBody, lang: "fr" })).statusCode).toBe(400);
  });
});

describe("api/explain", () => {
  const term = { name: "Jokowi 假學歷爭議", kind: "topic", mentions: ["ijazah"], gist: "學歷造假指控" };

  it("passes the term through", async () => {
    explainMock.mockResolvedValue({ lines: ["…"], sources: [], searched: true });
    const res = await call(explainHandler, { ...goodBody, term });
    expect(res.statusCode).toBe(200);
    expect(explainMock).toHaveBeenCalledWith("openai", goodBody, { term });
  });

  it("accepts the overview and background briefs instead of a term", async () => {
    explainMock.mockResolvedValue({ lines: ["…"], sources: [], searched: false });
    expect((await call(explainHandler, { ...goodBody, brief: "background" })).statusCode).toBe(200);
    expect(explainMock).toHaveBeenCalledWith("openai", goodBody, { brief: "background" });
    expect((await call(explainHandler, { ...goodBody, brief: "gossip" })).statusCode).toBe(400);
  });

  it("rejects a missing or malformed term", async () => {
    expect((await call(explainHandler, goodBody)).statusCode).toBe(400);
    expect((await call(explainHandler, { ...goodBody, term: { ...term, kind: "gossip" } })).statusCode).toBe(400);
    expect(explainMock).not.toHaveBeenCalled();
  });

  it("maps provider failures to 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    explainMock.mockRejectedValue(new Error("boom"));
    const res = await call(explainHandler, { ...goodBody, term });
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ error: "llm_error", provider: "openai" });
  });
});
