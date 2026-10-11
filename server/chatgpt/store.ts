import { kvConfig, upstashKv, type Kv } from "./kv.js";
import { applyTokens, OAuthError, refreshTokens, type ChatGPTCredentials } from "./oauth.js";

// The signed-in ChatGPT account lives in Redis, because each refresh replaces
// the refresh token and serverless functions have nowhere else to keep it.
// Refreshes are serialised with a short Redis lock, as the docs require
// ("serialize refreshes for the same session so two processes do not race a
// rotating token").

const CREDS_KEY = "liaoban:chatgpt:credentials";
const LOCK_KEY = "liaoban:chatgpt:refresh-lock";
const STATUS_KEY = "liaoban:chatgpt:status";

// Refresh this long before expiry, so a call never starts with a dying token.
const REFRESH_MARGIN_MS = 5 * 60_000;
const LOCK_TTL_MS = 15_000;
const LOCK_WAIT_MS = 250;
const LOCK_TRIES = 40;

export class NoCredentialsError extends Error {
  constructor() {
    super("ChatGPT plan is not connected");
  }
}

export type ChatGPTStatus = {
  connected: boolean;
  email?: string;
  model?: string;
  /** Last time a call was paid by the plan, and the last failure that fell back to the API key. */
  lastPlanUseAt?: number;
  lastError?: { at: number; message: string };
};

type Deps = { kv?: Kv | null; fetchImpl?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void> };

function kvOf(deps: Deps): Kv | null {
  if (deps.kv !== undefined) return deps.kv;
  const cfg = kvConfig();
  return cfg ? upstashKv(cfg) : null;
}

export function storeConfigured(): boolean {
  return kvConfig() !== null;
}

export async function loadCredentials(deps: Deps = {}): Promise<ChatGPTCredentials | null> {
  const kv = kvOf(deps);
  const raw = kv ? await kv.get(CREDS_KEY) : null;
  return raw ? (JSON.parse(raw) as ChatGPTCredentials) : null;
}

export async function saveCredentials(c: ChatGPTCredentials, deps: Deps = {}): Promise<void> {
  const kv = kvOf(deps);
  if (!kv) throw new Error("Redis is not configured (KV_REST_API_URL / KV_REST_API_TOKEN)");
  await kv.set(CREDS_KEY, JSON.stringify(c));
}

export async function deleteCredentials(deps: Deps = {}): Promise<void> {
  const kv = kvOf(deps);
  if (!kv) return;
  await kv.del(CREDS_KEY);
  await kv.del(STATUS_KEY);
}

/**
 * A valid access token and the model to use, refreshing it first if it's about
 * to expire. Only one caller refreshes; the others wait and read the result.
 */
export async function getAccess(deps: Deps = {}): Promise<{ token: string; model?: string }> {
  const kv = kvOf(deps);
  if (!kv) throw new NoCredentialsError();
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  for (let i = 0; i < LOCK_TRIES; i++) {
    const creds = await loadCredentials({ kv });
    if (!creds) throw new NoCredentialsError();
    if (creds.expiresAt - REFRESH_MARGIN_MS > now()) return { token: creds.accessToken, ...(creds.model ? { model: creds.model } : {}) };

    if (await kv.setIfAbsent(LOCK_KEY, String(now()), LOCK_TTL_MS)) {
      try {
        // Read again under the lock: another instance may have just refreshed.
        const fresh = (await loadCredentials({ kv })) ?? creds;
        if (fresh.expiresAt - REFRESH_MARGIN_MS > now()) return { token: fresh.accessToken, ...(fresh.model ? { model: fresh.model } : {}) };
        const t = await refreshTokens({ clientId: fresh.clientId, refreshToken: fresh.refreshToken }, deps.fetchImpl);
        const next = applyTokens(fresh, t, now());
        await kv.set(CREDS_KEY, JSON.stringify(next));
        return { token: next.accessToken, ...(next.model ? { model: next.model } : {}) };
      } catch (e) {
        // A rejected refresh token won't recover by itself: the owner has to sign in again.
        if (e instanceof OAuthError && (e.status === 400 || e.status === 401)) {
          await recordError(`Refresh rejected (${e.code ?? e.status}); run the login script again`, { kv, now });
        }
        throw e;
      } finally {
        await kv.del(LOCK_KEY);
      }
    }
    await sleep(LOCK_WAIT_MS);
  }
  throw new Error("Timed out waiting for another token refresh");
}

async function readStatus(kv: Kv): Promise<Omit<ChatGPTStatus, "connected" | "email" | "model">> {
  const raw = await kv.get(STATUS_KEY);
  return raw ? (JSON.parse(raw) as Omit<ChatGPTStatus, "connected" | "email" | "model">) : {};
}

export async function recordPlanUse(deps: Deps = {}): Promise<void> {
  const kv = kvOf(deps);
  if (!kv) return;
  const s = await readStatus(kv);
  await kv.set(STATUS_KEY, JSON.stringify({ ...s, lastPlanUseAt: (deps.now ?? Date.now)() }));
}

export async function recordError(message: string, deps: Deps = {}): Promise<void> {
  const kv = kvOf(deps);
  if (!kv) return;
  const s = await readStatus(kv);
  await kv.set(STATUS_KEY, JSON.stringify({ ...s, lastError: { at: (deps.now ?? Date.now)(), message: message.slice(0, 300) } }));
}

/** For the settings screen: never includes tokens. */
export async function chatgptStatus(deps: Deps = {}): Promise<ChatGPTStatus> {
  const kv = kvOf(deps);
  if (!kv) return { connected: false };
  const creds = await loadCredentials({ kv });
  return {
    connected: creds !== null,
    ...(creds?.email ? { email: creds.email } : {}),
    ...(creds?.model ? { model: creds.model } : {}),
    ...(await readStatus(kv)),
  };
}
