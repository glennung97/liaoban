import { createHash, randomBytes } from "node:crypto";

// "Sign in with ChatGPT" for ChatGPT plan usage, as documented at
// https://developers.openai.com/siwc/token-sharing-open-source (checked 2026-10-12):
// authorization code + PKCE with a 127.0.0.1 loopback redirect, dynamic client
// registration (no client secret), access tokens valid 1 hour, refresh tokens
// valid 30 days and replaced on every refresh. Plan tokens call the public
// Responses API with stream: true and store: false.

export const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";
export const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
export const ISSUER = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const AGENT_NAME = "Liaoban";

/** What the app keeps for one signed-in ChatGPT account. Tokens never leave the server. */
export type ChatGPTCredentials = {
  /** Issued at registration (e.g. oaiapp_…); used for refreshes and re-sign-in. */
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** Kept as id_token_hint for a later re-sign-in. */
  idToken?: string;
  email?: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  /** Model to use with this account (must be in its model list). */
  model?: string;
};

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
};

// Plain fields (no parameter properties): the login script runs under Node's type stripping.
export class OAuthError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

/** PKCE S256: base64url SHA-256 of the verifier, without padding. */
export function codeChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

export function authorizeUrl(p: {
  /** The issued client ID on re-sign-in; omit for a first registration. */
  clientId?: string;
  hostId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  challenge: string;
  idTokenHint?: string;
  loginHint?: string;
}): string {
  const q = new URLSearchParams({
    client_id: p.clientId ?? DYNAMIC_CLIENT_ID,
    ...(p.clientId ? {} : { agent_name_hint: AGENT_NAME }),
    ext_agent_host_id: p.hostId,
    ...(p.clientId && p.idTokenHint ? { id_token_hint: p.idTokenHint } : {}),
    ...(p.clientId && p.loginHint ? { login_hint: p.loginHint } : {}),
    response_type: "code",
    redirect_uri: p.redirectUri,
    scope: SCOPE,
    resource: RESOURCE,
    state: p.state,
    nonce: p.nonce,
    code_challenge_method: "S256",
    code_challenge: p.challenge,
  });
  return `${AUTHORIZE_URL}?${q}`;
}

async function postToken(body: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !data.access_token || typeof data.expires_in !== "number") {
    throw new OAuthError(
      `Token endpoint returned ${res.status}${data.error ? ` (${data.error})` : ""}`,
      res.status,
      data.error,
    );
  }
  return data as TokenResponse;
}

/** The client ID issued at registration is in the ID token's `aud` (and the access token's `client_id`). */
export function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) throw new Error("Not a JWT");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

export function exchangeCode(
  p: { clientId: string; code: string; verifier: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return postToken(
    {
      grant_type: "authorization_code",
      client_id: p.clientId,
      code: p.code,
      code_verifier: p.verifier,
      redirect_uri: p.redirectUri,
      resource: RESOURCE,
    },
    fetchImpl,
  );
}

/** Refresh with the issued client ID; scope is omitted to keep the grant. */
export function refreshTokens(
  p: { clientId: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return postToken(
    { grant_type: "refresh_token", client_id: p.clientId, refresh_token: p.refreshToken, resource: RESOURCE },
    fetchImpl,
  );
}

/** Merges a token response into stored credentials (a refresh always returns a replacement refresh token). */
export function applyTokens(prev: ChatGPTCredentials, t: TokenResponse, now = Date.now()): ChatGPTCredentials {
  return {
    ...prev,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? prev.refreshToken,
    ...(t.id_token ? { idToken: t.id_token } : {}),
    expiresAt: now + t.expires_in * 1000,
  };
}

/** Basic shape check for credentials uploaded by the login script. */
export function isCredentials(v: unknown): v is ChatGPTCredentials {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.clientId === "string" &&
    c.clientId.length > 0 &&
    c.clientId !== DYNAMIC_CLIENT_ID &&
    typeof c.accessToken === "string" &&
    typeof c.refreshToken === "string" &&
    c.refreshToken.length > 0 &&
    typeof c.expiresAt === "number" &&
    (c.model === undefined || typeof c.model === "string") &&
    (c.email === undefined || typeof c.email === "string") &&
    (c.idToken === undefined || typeof c.idToken === "string")
  );
}
