import type { SessionStatus } from "../lib/scribeSession.ts";

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: "待機",
  connecting: "連線中",
  live: "收音中",
  reconnecting: "重新連線",
  error: "錯誤",
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h > 0 ? `${h}:` : ""}${pad(m)}:${pad(s % 60)}`;
}

type Props = {
  status: SessionStatus;
  elapsedMs: number;
  recording: boolean;
  busy: boolean;
  /** Why Record is unavailable (e.g. no passcode), or null. */
  blocked: string | null;
  error: string | null;
  notice: string | null;
  onToggle(): void;
  onHistory(): void;
  onSettings(): void;
  /** Set while a past conversation is open: replaces the controls with a back bar. */
  viewing: { label: string; onBack(): void } | null;
};

export function TopBar(p: Props) {
  if (p.viewing) {
    return (
      <header className="topbar">
        <div className="row">
          <button type="button" className="icon-button" onClick={p.viewing.onBack}>
            ‹ 返回
          </button>
          <span className="viewing-label">{p.viewing.label}</span>
        </div>
      </header>
    );
  }

  return (
    <header className="topbar">
      <div className="row">
        <h1 className="brand">聊伴</h1>
        <span className={`status status-${p.status}`} title={STATUS_LABEL[p.status]}>
          <span className="dot" aria-hidden="true" />
          <span className="timer">{formatElapsed(p.elapsedMs)}</span>
        </span>
        <span className="spacer" />
        <button type="button" className="icon-button" aria-label="歷史對話 History" onClick={p.onHistory}>
          ☰
        </button>
        <button type="button" className="icon-button" aria-label="設定 Settings" onClick={p.onSettings}>
          ⚙
        </button>
        <button
          type="button"
          className={`record ${p.recording ? "on" : ""}`}
          disabled={p.busy || (!p.recording && p.blocked !== null)}
          onClick={p.onToggle}
        >
          {p.recording ? "■ 停止" : "● 錄音"}
        </button>
      </div>
      {p.error && <p className="error">{p.error}</p>}
      {p.notice && !p.error && <p className="notice">{p.notice}</p>}
      {!p.recording && p.blocked && !p.error && (
        <button type="button" className="notice link" onClick={p.onSettings}>
          {p.blocked}
        </button>
      )}
    </header>
  );
}
