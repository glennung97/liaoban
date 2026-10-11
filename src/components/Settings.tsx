import { useEffect, useState } from "react";
import type { Billing, Provider } from "../../server/llm/types.ts";
import { LANG_PRESETS, type LangPreset } from "../config.ts";
import { AI_LABEL, chatgptConnection, SUMMARY_INTERVALS, type ChatGPTStatus } from "../lib/analyzer.ts";
import { clockTime } from "../lib/transcript.ts";

type Props = {
  onClose(): void;
  passcode: string;
  onPasscode(v: string): void;
  recording: boolean;
  lang: LangPreset;
  onLang(v: LangPreset): void;
  aiOn: boolean;
  onAiOn(v: boolean): void;
  ai: Provider;
  onAi(v: Provider): void;
  liveSeconds: number;
  onLiveSeconds(v: number): void;
  context: string;
  onContext(v: string): void;
  keyterms: string;
  onKeyterms(v: string): void;
  keytermCount: number;
  aiStatus: { text: string; error: boolean } | null;
  /** Who paid for the latest AI call, if known. */
  billing: Billing | null;
  canStartNew: boolean;
  onNewConversation(): void;
};

/** Everything that used to crowd the header, in one sheet. */
export function Settings(p: Props) {
  return (
    <div className="sheet-backdrop" onClick={p.onClose}>
      <section className="sheet" role="dialog" aria-label="設定 Settings" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>設定</h2>
          <button type="button" className="icon-button" aria-label="關閉 Close" onClick={p.onClose}>
            ×
          </button>
        </div>

        <label className="field">
          <span>通關密碼</span>
          <input
            type="password"
            autoComplete="off"
            value={p.passcode}
            onChange={(e) => p.onPasscode(e.target.value)}
            placeholder="APP_PASSCODE"
          />
        </label>

        <label className="field">
          <span>語言</span>
          <select value={p.lang} disabled={p.recording} onChange={(e) => p.onLang(e.target.value as LangPreset)}>
            {(Object.keys(LANG_PRESETS) as LangPreset[]).map((k) => (
              <option key={k} value={k}>
                {LANG_PRESETS[k].label}
              </option>
            ))}
          </select>
        </label>
        {p.recording && <span className="hint">錄音中不能換語言，停止後再換。</span>}

        <label className="field">
          <span>AI 助理</span>
          <span className="switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="AI 助理開關 AI assistant on/off"
              checked={p.aiOn}
              onChange={(e) => p.onAiOn(e.target.checked)}
            />
            <span className="track" aria-hidden="true" />
          </span>
        </label>
        {p.aiStatus && <span className={`hint${p.aiStatus.error ? " ai-error" : ""}`}>{p.aiStatus.text}</span>}

        <label className="field column">
          <span>情境（選填：你是誰、在跟誰聊）</span>
          <textarea
            rows={2}
            value={p.context}
            onChange={(e) => p.onContext(e.target.value)}
            placeholder="例：我是台灣人，在雅加達搭 Grab，印尼語還不太好"
          />
        </label>

        <label className="field column">
          <span>關鍵詞（{p.keytermCount}/50，人名、地名，一行一個，下次錄音生效）</span>
          <textarea rows={2} value={p.keyterms} onChange={(e) => p.onKeyterms(e.target.value)} placeholder={"Budi\nPIK"} />
        </label>

        <label className="field">
          <span>即時整理</span>
          <select value={p.liveSeconds} onChange={(e) => p.onLiveSeconds(Number(e.target.value))}>
            {SUMMARY_INTERVALS.map((n) => (
              <option key={n} value={n}>
                每 {n} 秒
              </option>
            ))}
          </select>
        </label>

        {p.ai === "openai" && <ChatGPTPlan passcode={p.passcode} billing={p.billing} />}

        <label className="field">
          <span>模型</span>
          <select value={p.ai} onChange={(e) => p.onAi(e.target.value as Provider)}>
            {(Object.keys(AI_LABEL) as Provider[]).map((k) => (
              <option key={k} value={k}>
                {AI_LABEL[k]}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="wide" disabled={!p.canStartNew} onClick={p.onNewConversation}>
          ＋ 開始新對話
        </button>
        <span className="hint">目前的對話會留在「歷史對話」裡。對話只存在這支手機的瀏覽器。</span>
      </section>
    </div>
  );
}

const LOGIN_COMMAND = "npm run chatgpt-login -- --upload https://liaoban.vercel.app";

/** Whether OpenAI calls run on the owner's ChatGPT plan, and who paid last. */
function ChatGPTPlan({ passcode, billing }: { passcode: string; billing: Billing | null }) {
  const [status, setStatus] = useState<ChatGPTStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!passcode) return;
    let alive = true;
    chatgptConnection(passcode)
      .then((s) => alive && setStatus(s))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [passcode]);

  const disconnect = async () => {
    if (!confirm("中斷 ChatGPT 方案？之後改用 API key。")) return;
    try {
      setStatus(await chatgptConnection(passcode, "DELETE"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="field column plan">
      <span>ChatGPT 方案</span>
      {error && <span className="hint ai-error">{error}</span>}
      {status?.connected ? (
        <div className="row">
          <span className="hint">
            已連接{status.email ? ` ${status.email}` : ""}
            {status.model ? ` · ${status.model}` : ""}
          </span>
          <button type="button" className="ghost" onClick={() => void disconnect()}>
            中斷
          </button>
        </div>
      ) : (
        status && (
          <span className="hint">
            未連接，目前用 API key。在 Mac 的 liaoban 資料夾執行 <code>{LOGIN_COMMAND}</code> 登入 ChatGPT 即可改用方案額度。
          </span>
        )
      )}
      {billing && <span className="hint">上一次 AI 由 {billing === "chatgpt" ? "ChatGPT 方案" : "API key"} 支付</span>}
      {status?.lastError && (
        <span className="hint ai-error">
          {clockTime(status.lastError.at)} 改用 API key：{status.lastError.message}
        </span>
      )}
    </div>
  );
}
