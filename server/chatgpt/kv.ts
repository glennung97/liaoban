// Minimal Upstash Redis client over its REST API, so no extra dependency.
// The Vercel Marketplace integration sets KV_REST_API_URL / KV_REST_API_TOKEN
// (or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).

export type Kv = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  /** SET key value NX PX ms; true if the key was set (a lock was taken). */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  del(key: string): Promise<void>;
};

export function kvConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function upstashKv(cfg: { url: string; token: string }, fetchImpl: typeof fetch = fetch): Kv {
  const command = async (args: (string | number)[]): Promise<unknown> => {
    const res = await fetchImpl(cfg.url, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(args.map(String)),
    });
    const data = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!res.ok || data.error) throw new Error(`Upstash ${String(args[0])} failed: ${data.error ?? res.status}`);
    return data.result;
  };
  return {
    get: async (key) => {
      const r = await command(["GET", key]);
      return typeof r === "string" ? r : null;
    },
    set: async (key, value) => {
      await command(["SET", key, value]);
    },
    setIfAbsent: async (key, value, ttlMs) => (await command(["SET", key, value, "NX", "PX", ttlMs])) === "OK",
    del: async (key) => {
      await command(["DEL", key]);
    },
  };
}

/** An in-memory Kv for tests. */
export function memoryKv(): Kv & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const expires = new Map<string, number>();
  const live = (k: string) => {
    const e = expires.get(k);
    if (e !== undefined && e <= Date.now()) {
      data.delete(k);
      expires.delete(k);
    }
    return data.has(k);
  };
  return {
    data,
    get: async (k) => (live(k) ? data.get(k)! : null),
    set: async (k, v) => {
      data.set(k, v);
      expires.delete(k);
    },
    setIfAbsent: async (k, v, ttl) => {
      if (live(k)) return false;
      data.set(k, v);
      expires.set(k, Date.now() + ttl);
      return true;
    },
    del: async (k) => {
      data.delete(k);
      expires.delete(k);
    },
  };
}
