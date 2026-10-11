import type { HistoryEntry } from "../lib/history.ts";
import { clockTime } from "../lib/transcript.ts";

type Props = {
  entries: HistoryEntry[];
  currentId: string;
  onOpen(id: string): void;
  onDelete(id: string): void;
  onClose(): void;
};

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "今天";
  if (same(d, yesterday)) return "昨天";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function minutes(e: HistoryEntry): string {
  const m = Math.max(1, Math.round((e.updatedAt - e.startedAt) / 60_000));
  return `${m} 分鐘`;
}

/** Full-screen list of past conversations saved on this device. */
export function HistoryView({ entries, currentId, onOpen, onDelete, onClose }: Props) {
  return (
    <div className="history">
      <header className="topbar">
        <div className="row">
          <button type="button" className="icon-button" onClick={onClose}>
            ‹ 返回
          </button>
          <h2 className="viewing-label">歷史對話</h2>
        </div>
      </header>
      {entries.length === 0 && <p className="placeholder">還沒有存下的對話。</p>}
      <ul className="history-list">
        {entries.map((e) => (
          <li key={e.id}>
            <button type="button" className="history-item" onClick={() => onOpen(e.id)}>
              <span className="history-when">
                {dayLabel(e.startedAt)} {clockTime(e.startedAt).slice(0, 5)} · {minutes(e)}
                {e.id === currentId && <span className="badge">目前</span>}
              </span>
              <strong>{e.title || e.preview || "（沒有內容）"}</strong>
              {e.title && e.preview && <span className="muted history-preview">{e.preview}</span>}
              {e.termNames.length > 0 && <span className="history-terms">{e.termNames.join("、")}</span>}
            </button>
            {e.id !== currentId && (
              <button
                type="button"
                className="icon-button"
                aria-label="刪除 Delete"
                onClick={() => {
                  if (confirm("刪除這段對話？ Delete this conversation?")) onDelete(e.id);
                }}
              >
                🗑
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
