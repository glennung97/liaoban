// Connects your ChatGPT plan to Liaoban (Sign in with ChatGPT, self-hosted flow):
// sign in on this computer, then hand the credentials to the deployed app, which
// keeps and refreshes them from then on.
//
//   npm run chatgpt-login -- --upload https://liaoban.vercel.app [--model gpt-6-luna] [--port 1455]
//
// The passcode is read from LIAOBAN_PASSCODE or asked for. Without --upload the
// credentials stay in ~/.config/liaoban/ (owner-only) and the models are listed.
// After a successful upload the local tokens are deleted, so only the server
// refreshes them (refresh tokens rotate; two holders would break each other).
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  authorizeUrl,
  codeChallenge,
  decodeJwt,
  DYNAMIC_CLIENT_ID,
  exchangeCode,
  ISSUER,
  randomToken,
  type ChatGPTCredentials,
} from "../server/chatgpt/oauth.ts";

const DIR = join(homedir(), ".config", "liaoban");
const HOST_FILE = join(DIR, "host.json");
const REG_FILE = join(DIR, "chatgpt-registration.json");
const CREDS_FILE = join(DIR, "chatgpt-credentials.json");
const PREFERRED_MODELS = ["gpt-6-luna", "gpt-6.1-sol"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Atomic, owner-only write. */
async function writeSecret(file: string, value: unknown) {
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // the URL is printed too
  }
}

/** Waits for the browser to come back to http://127.0.0.1:<port>/auth/callback. */
function waitForCallback(port: number): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/auth/callback") {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<p style='font:16px system-ui;padding:2em'>好了，可以關掉這個分頁，回到終端機。</p>");
      server.close();
      resolve(url.searchParams);
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1");
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out after 5 minutes waiting for the sign-in"));
    }, 5 * 60_000).unref();
  });
}

async function listModels(token: string): Promise<string[]> {
  const res = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Listing models failed (${res.status})`);
  const data = (await res.json()) as { data?: { id: string; visibility?: string }[] };
  return (data.data ?? []).filter((m) => m.visibility === undefined || m.visibility === "list").map((m) => m.id);
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function main() {
  const port = Number(arg("port") ?? 1455);
  const uploadTo = arg("upload")?.replace(/\/$/, "");

  // A stable, non-secret ID for this computer, created once.
  let host = await readJson<{ hostId: string }>(HOST_FILE);
  if (!host) {
    host = { hostId: `urn:uuid:${randomUUID()}` };
    await writeSecret(HOST_FILE, host);
  }
  const reg = await readJson<{ clientId: string; idToken?: string; email?: string }>(REG_FILE);

  const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
  const verifier = randomToken(48);
  const state = randomToken();
  const nonce = randomToken();
  const url = authorizeUrl({
    hostId: host.hostId,
    redirectUri,
    state,
    nonce,
    challenge: codeChallenge(verifier),
    ...(reg ? { clientId: reg.clientId } : {}),
    ...(reg?.idToken ? { idTokenHint: reg.idToken } : {}),
    ...(reg?.email ? { loginHint: reg.email } : {}),
  });

  console.log("在瀏覽器登入 ChatGPT（如果沒有自動打開，請複製這個網址）：\n\n" + url + "\n");
  const callback = waitForCallback(port);
  openBrowser(url);
  const q = await callback;

  if (q.get("state") !== state) throw new Error("State mismatch; start again");
  if (q.get("error")) throw new Error(`Sign-in was not completed: ${q.get("error")}`);
  const code = q.get("code");
  if (!code) throw new Error("No authorization code in the callback");
  const issued = q.get("client_id");
  if (reg && issued && issued !== reg.clientId) throw new Error("The callback returned a different client ID; start again");
  const clientId = issued ?? reg?.clientId;
  if (!clientId || clientId === DYNAMIC_CLIENT_ID) throw new Error("No issued client ID in the callback");

  const t = await exchangeCode({ clientId, code, verifier, redirectUri });
  if (!t.refresh_token) throw new Error("No refresh token: offline_access was not granted");
  const granted = (t.scope ?? "").split(/\s+/);
  if (!granted.includes("chatgpt.tokens.use.direct")) {
    throw new Error("ChatGPT plan usage was not granted (allow it on the consent screen, on a Plus or Pro plan)");
  }
  let email: string | undefined;
  if (t.id_token) {
    const claims = decodeJwt(t.id_token);
    if (claims.nonce !== nonce) throw new Error("ID token nonce mismatch; start again");
    if (claims.iss !== ISSUER) throw new Error(`Unexpected ID token issuer ${String(claims.iss)}`);
    if (typeof claims.email === "string") email = claims.email;
  }
  await writeSecret(REG_FILE, { clientId, ...(t.id_token ? { idToken: t.id_token } : {}), ...(email ? { email } : {}) });

  const models = await listModels(t.access_token).catch((e: unknown) => {
    console.warn(String(e));
    return [] as string[];
  });
  if (models.length) console.log(`\n這個帳號可用的模型：${models.join(", ")}`);
  const model = arg("model") ?? PREFERRED_MODELS.find((m) => models.includes(m)) ?? models[0];
  if (model) console.log(`Liaoban 會使用：${model}${models.length && !models.includes(model) ? "（不在清單上，可能無法使用）" : ""}`);

  const creds: ChatGPTCredentials = {
    clientId,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    ...(t.id_token ? { idToken: t.id_token } : {}),
    ...(email ? { email } : {}),
    ...(model ? { model } : {}),
  };

  if (!uploadTo) {
    await writeSecret(CREDS_FILE, creds);
    console.log(`\n已登入 ${email ?? ""}。憑證存在 ${CREDS_FILE}（只有你能讀）。加上 --upload <網址> 再跑一次就會上傳。`);
    return;
  }

  const passcode = process.env.LIAOBAN_PASSCODE || (await ask("Liaoban 通關密碼（APP_PASSCODE）："));
  const res = await fetch(`${uploadTo}/api/chatgpt-credentials`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-app-passcode": passcode },
    body: JSON.stringify({ credentials: creds }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; email?: string; model?: string };
  if (!res.ok) {
    await writeSecret(CREDS_FILE, creds);
    throw new Error(`Upload failed (${res.status} ${body.error ?? ""}); credentials kept in ${CREDS_FILE}`);
  }
  // The server owns the session now; a second copy would race its refreshes.
  await rm(CREDS_FILE, { force: true });
  console.log(`\n完成：${uploadTo} 現在使用 ${body.email ?? email ?? "你的"} ChatGPT 方案（模型 ${body.model ?? model ?? "預設"}）。`);
}

main().catch((e: unknown) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
