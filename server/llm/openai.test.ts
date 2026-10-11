import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Fake OpenAI client: records which key each call used and answers per `behaviour`.
const calls: { key: string | undefined; params: Record<string, unknown> }[] = [];
let behaviour: (key: string | undefined, params: Record<string, unknown>) => unknown = () => ({});

vi.mock("openai", () => {
  class BadRequestError extends Error {}
  class FakeOpenAI {
    static BadRequestError = BadRequestError;
    key: string | undefined;
    constructor(opts?: { apiKey?: string }) {
      this.key = opts?.apiKey;
    }
    responses = {
      stream: (params: Record<string, unknown>) => ({
        finalResponse: async () => {
          calls.push({ key: this.key, params });
          return behaviour(this.key, params);
        },
      }),
    };
  }
  return { default: FakeOpenAI };
});
vi.mock("openai/helpers/zod", () => ({ zodTextFormat: () => ({ type: "json_schema" }) }));

const store = {
  storeConfigured: vi.fn(() => true),
  getAccess: vi.fn(async () => ({ token: "plan-token", model: "gpt-6.1-sol" })),
  recordPlanUse: vi.fn(async () => {}),
  recordError: vi.fn(async () => {}),
  NoCredentialsError: class extends Error {},
};
vi.mock("../chatgpt/store.js", () => store);

const { callOpenAI } = await import("./openai.ts");

const req = {
  system: "s",
  transcript: "t",
  schema: z.object({ ok: z.boolean() }),
  name: "x",
  cacheKey: "k",
  effort: "low" as const,
};
const parsed = { output_parsed: { ok: true }, model: "m", usage: { input_tokens: 1, output_tokens: 1 } };

describe("OpenAI auth: ChatGPT plan first, API key as fallback", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("CHATGPT_MODEL", "");
    store.getAccess.mockResolvedValue({ token: "plan-token", model: "gpt-6.1-sol" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the plan token and model, streams, stores nothing, and skips the cache key", async () => {
    behaviour = () => parsed;
    const r = await callOpenAI(req);
    expect(r.billing).toBe("chatgpt");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe("plan-token");
    expect(calls[0]!.params).toMatchObject({ model: "gpt-6.1-sol", store: false });
    expect(calls[0]!.params).not.toHaveProperty("prompt_cache_key");
  });

  it("falls back to the API key when the plan request fails, and records why", async () => {
    behaviour = (key) => {
      if (key === "plan-token") throw new Error("subscription_sharing_usage_limit_exceeded");
      return parsed;
    };
    const r = await callOpenAI(req);
    expect(r.billing).toBe("api_key");
    expect(calls.map((c) => c.key)).toEqual(["plan-token", undefined]);
    expect(calls[1]!.params).toMatchObject({ model: "gpt-6-luna", prompt_cache_key: "k" });
    expect(store.recordError).toHaveBeenCalledWith("subscription_sharing_usage_limit_exceeded");
  });

  it("uses the API key when no plan is connected", async () => {
    store.getAccess.mockRejectedValueOnce(new store.NoCredentialsError());
    behaviour = () => parsed;
    expect((await callOpenAI(req)).billing).toBe("api_key");
  });

  it("without an API key, a plan failure is reported instead of hidden", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    behaviour = () => {
      throw new Error("limit");
    };
    await expect(callOpenAI(req)).rejects.toThrow("limit");
  });
});
