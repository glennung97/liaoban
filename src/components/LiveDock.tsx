import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { BriefKind } from "../../server/llm/types.ts";
import { clockTime } from "../lib/transcript.ts";
import type { LiveNote, Term } from "../types.ts";
import { Avatar } from "./TermCard.tsx";

const COLLAPSED_KEY = "liaoban.dockCollapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(v: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
  } catch {
    // storage unavailable
  }
}

// Drag at least this far (px) to collapse or expand; less counts as a tap.
const DRAG_THRESHOLD = 40;
const TAP_SLOP = 6;

type Props = {
  /** Live updates possible (AI on, passcode set, something said). False for past conversations. */
  ready: boolean;
  /** 在聊什麼／背景知識 and term lookups possible. */
  canAsk: boolean;
  note: LiveNote | undefined;
  busy: boolean;
  error: string | undefined;
  seconds: number;
  onRefresh(): void;
  onBrief(kind: BriefKind): void;
  /** Newest first. */
  terms: readonly Term[];
  /** Keys of terms that already have an explanation / are being looked up. */
  answered: ReadonlySet<string>;
  loading: ReadonlySet<string>;
  openKey: string | null;
  onTerm(key: string): void;
  /** The open popup, shown above the panel. */
  card: ReactNode;
};

/**
 * Bottom panel, refreshed by Luna every few seconds: what's being talked about,
 * background chips (tap for the popup) and things to say next. Drag the handle
 * down to shrink it to one line, up to open it again.
 */
export function LiveDock(p: Props) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ startY: number; id: number } | null>(null);
  const n = p.note;

  const setAndSave = (v: boolean) => {
    setCollapsed(v);
    saveCollapsed(v);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.startY;
    // Follow the finger a little, only in the direction that changes something.
    setDragY(collapsed ? Math.min(0, dy) / 3 : Math.max(0, dy));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setDragY(0);
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) < TAP_SLOP) setAndSave(!collapsed);
    else if (dy > DRAG_THRESHOLD) setAndSave(true);
    else if (dy < -DRAG_THRESHOLD) setAndSave(false);
  };

  return (
    <section
      className={`dock${collapsed ? " collapsed" : ""}`}
      aria-label="Luna"
      style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
    >
      <div
        className="handle"
        role="button"
        tabIndex={0}
        aria-label={collapsed ? "展開 Expand" : "收合 Collapse"}
        aria-expanded={!collapsed}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setDragY(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setAndSave(!collapsed);
          }
        }}
      >
        <span className="grip" aria-hidden="true" />
      </div>

      {p.card}

      <div className="card">
        <div className="card-head">
          <span>
            現在
            <span className="muted">
              {p.busy ? " · 更新中…" : n ? ` · ${clockTime(n.at)}` : p.ready ? ` · 每 ${p.seconds} 秒更新` : ""}
            </span>
            {p.ready && (
              <button type="button" className="icon-button inline" aria-label="現在更新 Refresh" disabled={p.busy} onClick={p.onRefresh}>
                ↻
              </button>
            )}
          </span>
          {!collapsed && (
            <span className="brief-buttons">
              <button type="button" className="pill" disabled={!p.canAsk} onClick={() => p.onBrief("overview")}>
                在聊什麼？
              </button>
              <button type="button" className="pill" disabled={!p.canAsk} onClick={() => p.onBrief("background")}>
                背景知識
              </button>
            </span>
          )}
        </div>
        {p.error && <p className="ai-error">{p.error}</p>}
        {n ? (
          <>
            <p className="now">{n.now}</p>
            {!collapsed && n.points.length > 0 && (
              <ul className="points">
                {n.points.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          !p.error && !collapsed && <p className="muted">開始聊天後，Luna 會即時告訴你在聊什麼、背景和可以怎麼接話。</p>
        )}
      </div>

      {p.terms.length > 0 && (
        <div className="chips" aria-label="背景">
          {p.terms.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`chip chip-${t.kind}${p.openKey === t.key ? " open" : ""}`}
              onClick={() => p.onTerm(t.key)}
            >
              {t.kind === "person" && <Avatar term={t} size="sm" />}
              {t.kind === "question" && (
                <span className="chip-mark" aria-hidden="true">
                  {p.loading.has(t.key) ? "…" : p.answered.has(t.key) ? "✓" : "🔍"}
                </span>
              )}
              <span className="chip-text">
                <span>{t.name}</span>
                {t.zh && <span className="chip-zh">{t.zh}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {!collapsed && n && n.questions.length > 0 && (
        <div className="card">
          <div className="card-head">
            <span>可以這樣接</span>
          </div>
          <ul className="suggestions">
            {n.questions.map((q, i) => (
              <li key={i}>
                {q.angle && <span className="angle">{q.angle}</span>}
                <span className="say">{q.say}</span>
                {q.meaning && <span className="meaning">{q.meaning}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
