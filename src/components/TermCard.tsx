import type { ReactNode } from "react";
import { clockTime } from "../lib/transcript.ts";
import type { Explanation, Photo, Term } from "../types.ts";

export type ExplainState = { busy: boolean; error?: string };

type Props = {
  label: string;
  title: string;
  /** Smaller, lighter Chinese name under an original-language title. */
  zh?: string | undefined;
  gist?: string | undefined;
  avatar?: ReactNode;
  photo?: Photo | null | undefined;
  explanation: Explanation | undefined;
  state: ExplainState | undefined;
  /** Shown while there is no explanation yet and nothing is loading. */
  emptyText?: string;
  canAsk: boolean;
  onAsk(): void;
  onClose(): void;
};

/**
 * The popup for a term (or for 在聊什麼／背景知識). It stays open above the
 * live panel until closed.
 */
export function InfoCard(p: Props) {
  const { explanation: ex, state } = p;
  return (
    <article className="card term-card" aria-label={p.title}>
      <div className="term-head">
        {p.avatar}
        <div className="term-title">
          <span className="term-kind">{p.label}</span>
          <strong>{p.title}</strong>
          {p.zh && <span className="term-zh">{p.zh}</span>}
          {p.gist && <span className="term-gist">{p.gist}</span>}
        </div>
        <button type="button" className="icon-button" aria-label="關閉 Close" onClick={p.onClose}>
          ×
        </button>
      </div>

      {state?.busy && <p className="muted">Luna 查資料中…</p>}
      {state?.error && <p className="ai-error">{state.error}</p>}
      {!ex && !state?.busy && !state?.error && p.emptyText && <p className="muted">{p.emptyText}</p>}
      {ex && !state?.busy && (
        <>
          <ul className="points">
            {ex.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {ex.sources.length > 0 && (
            <p className="sources">
              來源：
              {ex.sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer noopener">
                  {s.title}
                </a>
              ))}
            </p>
          )}
        </>
      )}

      <div className="term-foot">
        <span className="muted">
          {ex ? `${ex.searched ? "已上網查詢" : "依 AI 既有知識，可能不是最新"} · ${clockTime(ex.at)}` : ""}
          {p.photo && (
            <>
              {ex ? " · " : ""}照片：
              <a href={p.photo.url} target="_blank" rel="noreferrer noopener">
                {p.photo.title}
              </a>
            </>
          )}
        </span>
        {!state?.busy && p.canAsk && (
          <button type="button" className="ghost" onClick={p.onAsk}>
            {ex ? "↻ 重查" : "查詳細"}
          </button>
        )}
      </div>
    </article>
  );
}

export function Avatar({ term, size }: { term: Term; size: "sm" | "lg" }) {
  if (!term.photo) {
    return (
      <span className={`avatar avatar-${size} avatar-empty`} aria-hidden="true">
        👤
      </span>
    );
  }
  return <img className={`avatar avatar-${size}`} src={term.photo.thumb} alt={term.photo.title} loading="lazy" />;
}
