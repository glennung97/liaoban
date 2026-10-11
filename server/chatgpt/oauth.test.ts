import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { applyTokens, authorizeUrl, codeChallenge, isCredentials, refreshTokens, exchangeCode, OAuthError } from "./oauth.ts";

describe("PKCE and authorize URL", () => {
  it("computes the S256 challenge: base64url SHA-256 without padding", () => {
    const verifier = "test-verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
    const expected = createHash("sha256").update(verifier).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(codeChallenge(verifier)).toBe(expected);
    expect(codeChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  const base = { hostId: "urn:uuid:h", redirectUri: "http://127.0.0.1:1455/auth/callback", state: "s", nonce: "n", challenge: "c" };

  it("registers dynamically the first time, with the plan-usage scopes", () => {
    const q = new URL(authorizeUrl(base)).searchParams;
    expect(q.get("client_id")).toBe("dynamic_agent_client");
    expect(q.get("agent_name_hint")).toBe("Liaoban");
    expect(q.get("scope")).toBe("openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
    expect(q.get("resource")).toBe("https://api.openai.com/v1");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("id_token_hint")).toBeNull();
  });

  it("re-signs in with the issued client ID and hints, without the name hint", () => {
    const q = new URL(authorizeUrl({ ...base, clientId: "oaiapp_1", idTokenHint: "jwt", loginHint: "a@b.c" })).searchParams;
    expect(q.get("client_id")).toBe("oaiapp_1");
    expect(q.get("agent_name_hint")).toBeNull();
    expect(q.get("id_token_hint")).toBe("jwt");
    expect(q.get("login_hint")).toBe("a@b.c");
  });
});

describe("token endpoint", () => {
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

  it("exchanges the code with the issued client ID and the resource", async () => {
    const f = ok({ access_token: "a", refresh_token: "r", expires_in: 3600 });
    await exchangeCode({ clientId: "oaiapp_1", code: "c", verifier: "v", redirectUri: "http://127.0.0.1:1455/auth/callback" }, f);
    const body = new URLSearchParams(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "authorization_code",
      client_id: "oaiapp_1",
      code: "c",
      code_verifier: "v",
      redirect_uri: "http://127.0.0.1:1455/auth/callback",
      resource: "https://api.openai.com/v1",
    });
  });

  it("refreshes without a scope and reports errors with their code", async () => {
    const f = ok({ access_token: "a2", refresh_token: "r2", expires_in: 3600 });
    await refreshTokens({ clientId: "oaiapp_1", refreshToken: "r1" }, f);
    const body = new URLSearchParams(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("scope")).toBeNull();

    const bad = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    await expect(refreshTokens({ clientId: "x", refreshToken: "y" }, bad)).rejects.toMatchObject({ status: 400, code: "invalid_grant" });
    await expect(refreshTokens({ clientId: "x", refreshToken: "y" }, bad)).rejects.toBeInstanceOf(OAuthError);
  });

  it("applies a refresh: new access and refresh token, new expiry", () => {
    const prev = { clientId: "c", accessToken: "a1", refreshToken: "r1", expiresAt: 0, model: "m" };
    expect(applyTokens(prev, { access_token: "a2", refresh_token: "r2", expires_in: 3600 }, 1000)).toEqual({
      clientId: "c",
      accessToken: "a2",
      refreshToken: "r2",
      expiresAt: 3_601_000,
      model: "m",
    });
  });

  it("validates uploaded credentials", () => {
    expect(isCredentials({ clientId: "oaiapp_1", accessToken: "a", refreshToken: "r", expiresAt: 1 })).toBe(true);
    expect(isCredentials({ clientId: "dynamic_agent_client", accessToken: "a", refreshToken: "r", expiresAt: 1 })).toBe(false);
    expect(isCredentials({ clientId: "oaiapp_1", accessToken: "a", refreshToken: "", expiresAt: 1 })).toBe(false);
    expect(isCredentials("nope")).toBe(false);
  });
});
