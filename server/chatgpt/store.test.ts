import { describe, expect, it, vi } from "vitest";
import { memoryKv } from "./kv.ts";
import { chatgptStatus, deleteCredentials, getAccess, NoCredentialsError, saveCredentials } from "./store.ts";

const HOUR = 3_600_000;
const creds = (expiresAt: number) => ({ clientId: "oaiapp_1", accessToken: "a1", refreshToken: "r1", expiresAt, model: "gpt-6-luna", email: "me@x.y" });

function tokenServer(delayMs = 0) {
  let n = 1;
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body));
    if (body.get("refresh_token") !== `r${n}`) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    n++;
    return new Response(JSON.stringify({ access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 3600 }), { status: 200 });
  });
}

describe("token store", () => {
  it("returns the stored token while it is still fresh", async () => {
    const kv = memoryKv();
    const fetchImpl = tokenServer();
    await saveCredentials(creds(Date.now() + HOUR), { kv });
    expect(await getAccess({ kv, fetchImpl })).toEqual({ token: "a1", model: "gpt-6-luna" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes a token about to expire and keeps the rotated refresh token", async () => {
    const kv = memoryKv();
    const fetchImpl = tokenServer();
    await saveCredentials(creds(Date.now() + 60_000), { kv });
    expect((await getAccess({ kv, fetchImpl })).token).toBe("a2");
    expect((await getAccess({ kv, fetchImpl, now: () => Date.now() + 2 * HOUR })).token).toBe("a3");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refreshes only once when several requests need a new token at the same time", async () => {
    const kv = memoryKv();
    const fetchImpl = tokenServer(30);
    await saveCredentials(creds(0), { kv });
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms / 10));
    const tokens = await Promise.all([1, 2, 3].map(() => getAccess({ kv, fetchImpl, sleep })));
    expect(tokens.map((t) => t.token)).toEqual(["a2", "a2", "a2"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("records a rejected refresh so the settings screen can say to sign in again", async () => {
    const kv = memoryKv();
    await saveCredentials({ ...creds(0), refreshToken: "stale" }, { kv });
    await expect(getAccess({ kv, fetchImpl: tokenServer() })).rejects.toMatchObject({ status: 400 });
    const s = await chatgptStatus({ kv });
    expect(s).toMatchObject({ connected: true, email: "me@x.y", model: "gpt-6-luna" });
    expect(s.lastError?.message).toContain("login script");
    expect(JSON.stringify(s)).not.toContain("stale"); // never exposes tokens
  });

  it("says when nothing is connected", async () => {
    const kv = memoryKv();
    await expect(getAccess({ kv })).rejects.toBeInstanceOf(NoCredentialsError);
    await expect(getAccess({ kv: null })).rejects.toBeInstanceOf(NoCredentialsError);
    await saveCredentials(creds(Date.now() + HOUR), { kv });
    await deleteCredentials({ kv });
    expect(await chatgptStatus({ kv })).toEqual({ connected: false });
  });
});
