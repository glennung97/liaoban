import type { AnalyzeResult, BriefKind, ExplainResult, Lang, LiveResult, Provider, TermKind } from "../../server/llm/types.ts";

export const AI_LABEL: Record<Provider, string> = {
  openai: "GPT-6 Luna",
  anthropic: "Claude Haiku 5.5",
};

/** Keyterms typed one per line or separated by commas; ElevenLabs takes ≤50, each ≤20 characters. */
export function parseKeyterms(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,，、;；]+/)) {
    const t = raw.trim();
    if (!t || [...t].length > 20 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 50);
}

/** Key points are refreshed at most this often. */
export const HIGHLIGHT_INTERVAL_MS = 10_000;

/** Choices for the live panel's refresh; the user picks one in settings. */
export const SUMMARY_INTERVALS = [15, 30, 60, 120] as const;
export const DEFAULT_SUMMARY_SECONDS = 30;

/**
 * Runs `run` after new segments arrive: at most one call every `intervalMs`,
 * never two at once. If segments arrive during a call, one more call follows.
 * Calls are sequential, so the latest result is always the newest.
 */
export class AnalyzeScheduler {
  private pending = false;
  private inFlight = false;
  private lastStart = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly run: () => Promise<void>,
    public intervalMs = HIGHLIGHT_INTERVAL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  notify(): void {
    this.pending = true;
    this.schedule();
  }

  /** Counts the interval from now, so the first call waits a full interval (used for the recap). */
  holdOff(): void {
    this.lastStart = this.now();
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.schedule();
    }
  }

  /** Runs as soon as no call is in flight, ignoring the interval (a "refresh now" tap). */
  runNow(): void {
    this.lastStart = -Infinity;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.notify();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
  }

  private schedule() {
    if (this.inFlight || this.timer !== undefined || !this.pending) return;
    const delay = Math.max(0, this.lastStart + this.intervalMs - this.now());
    this.timer = setTimeout(() => this.fire(), delay);
  }

  private fire() {
    this.timer = undefined;
    if (!this.pending) return;
    this.pending = false;
    this.inFlight = true;
    this.lastStart = this.now();
    void this.run()
      .catch(() => {}) // the caller reports errors; keep scheduling
      .finally(() => {
        this.inFlight = false;
        this.schedule();
      });
  }
}

export class AnalyzeError extends Error {}

const ERROR_TEXT: Record<string, string> = {
  bad_passcode: "Wrong passcode",
  provider_not_configured: "This AI provider has no API key in Vercel",
  server_not_configured: "Server not configured (check Vercel env vars)",
  llm_error: "The AI request failed",
};

export type TranscriptRequest = {
  context: string;
  segments: { id: string; units: string[]; at?: string }[];
  conversationId: string;
  lang: Lang;
  provider: Provider;
};

export function requestAnalysis(passcode: string, body: TranscriptRequest): Promise<AnalyzeResult> {
  return postJson<AnalyzeResult>("/api/analyze", passcode, body);
}

export function requestLive(passcode: string, body: TranscriptRequest): Promise<LiveResult> {
  return postJson<LiveResult>("/api/live", passcode, body);
}

/** Explains a term, or gives the overview / background of the whole conversation. */
export function requestExplain(
  passcode: string,
  body: TranscriptRequest,
  what: { term: { name: string; kind: TermKind; mentions: string[]; gist?: string } } | { brief: BriefKind },
): Promise<ExplainResult> {
  return postJson<ExplainResult>("/api/explain", passcode, { ...body, ...what });
}

async function postJson<T>(path: string, passcode: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-passcode": passcode },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AnalyzeError("Network error while contacting the AI");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; status?: number };
  if (!res.ok) {
    const base = (data.error && ERROR_TEXT[data.error]) ?? `AI request failed (${res.status})`;
    throw new AnalyzeError(data.status ? `${base} (${data.status})` : base);
  }
  return data;
}

export type ChatGPTStatus = {
  connected: boolean;
  email?: string;
  model?: string;
  lastPlanUseAt?: number;
  lastError?: { at: number; message: string };
};

/** The ChatGPT plan connection (GET), or disconnect it (DELETE). Never returns tokens. */
export async function chatgptConnection(passcode: string, method: "GET" | "DELETE" = "GET"): Promise<ChatGPTStatus> {
  const res = await fetch("/api/chatgpt-credentials", { method, headers: { "x-app-passcode": passcode } });
  const data = (await res.json().catch(() => ({}))) as ChatGPTStatus & { error?: string };
  if (!res.ok) {
    throw new AnalyzeError(
      data.error === "store_not_configured" ? "還沒有設定 Redis（Upstash）" : (data.error && ERROR_TEXT[data.error]) ?? `(${res.status})`,
    );
  }
  return data;
}
