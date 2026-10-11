import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { unitKey, type UnitNote, type UnitsBySegment } from "../lib/annotations.ts";
import { splitByTerms } from "../lib/terms.ts";
import { clockTime, type TranscriptState } from "../lib/transcript.ts";
import type { Segment, Term } from "../types.ts";

type Props = {
  state: TranscriptState;
  units: UnitsBySegment;
  notes: Map<string, UnitNote>;
  terms: readonly Term[];
  openTerm: string | null;
  onTerm(key: string): void;
  /** Shown when there is nothing yet. */
  placeholder: string;
};

export function TranscriptView({ state, units, notes, terms, openTerm, onTerm, placeholder }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Follow new text unless the user has scrolled up to read something.
  useEffect(() => {
    const onScroll = () => {
      const el = document.scrollingElement ?? document.documentElement;
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [state.segments.length, state.partialRev]);

  const { segments, partial, freshFrom, partialRev } = state;
  const empty = segments.length === 0 && !partial;
  const kinds = new Map(terms.map((t) => [t.key, t.kind]));

  return (
    <main className="transcript" aria-live="polite">
      {empty && <p className="placeholder">{placeholder}</p>}
      {segments.map((s) => (
        <SegmentLine
          key={s.id}
          segment={s}
          units={units.get(s.id) ?? []}
          notes={notes}
          render={(text) =>
            splitByTerms(text, terms).map((piece, i) =>
              piece.termKey ? (
                <button
                  key={i}
                  type="button"
                  className={`term term-${kinds.get(piece.termKey)}${openTerm === piece.termKey ? " open" : ""}`}
                  onClick={() => onTerm(piece.termKey!)}
                >
                  {piece.text}
                </button>
              ) : (
                <Fragment key={i}>{piece.text}</Fragment>
              ),
            )
          }
        />
      ))}
      {partial && (
        <p className="segment partial">
          <span className="stamp">…</span>
          {partial.slice(0, freshFrom)}
          <span key={partialRev} className="fresh">
            {partial.slice(freshFrom)}
          </span>
        </p>
      )}
      <div ref={endRef} />
    </main>
  );
}

function SegmentLine(props: {
  segment: Segment;
  units: string[];
  notes: Map<string, UnitNote>;
  render(text: string): ReactNode;
}) {
  const { segment: s, units, notes, render } = props;
  return (
    <p className="segment" lang={s.lang}>
      <time className="stamp">{clockTime(s.startMs)}</time>
      {units.map((text, unit) => {
        const n = notes.get(unitKey({ segmentId: s.id, unit }));
        // Only the stronger key points are tinted, without tags, so the transcript stays calm
        // and the coloured words are the ones Luna can explain.
        if (!n || n.highlight.importance < 2) return <Fragment key={unit}>{render(text)}</Fragment>;
        return (
          <span key={unit} className={`hl hl-${n.highlight.importance}`} title={n.highlight.reason}>
            {render(text)}
          </span>
        );
      })}
    </p>
  );
}
