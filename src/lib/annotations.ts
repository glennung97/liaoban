import type { AnalyzeResult, HighlightResult, UnitRef } from "../../server/llm/types.ts";
import type { Segment } from "../types.ts";
import { splitUnits } from "./units.ts";

export type UnitsBySegment = Map<string, string[]>;

export function unitsBySegment(segments: readonly Segment[]): UnitsBySegment {
  return new Map(segments.map((s) => [s.id, splitUnits(s.text)]));
}

export const unitKey = (r: UnitRef) => `${r.segmentId}:${r.unit}`;

export type UnitNote = { highlight: HighlightResult; last: boolean };

/** All unit keys in transcript order. */
function orderedKeys(segments: readonly Segment[], units: UnitsBySegment): string[] {
  return segments.flatMap((s) => (units.get(s.id) ?? []).map((_, unit) => unitKey({ segmentId: s.id, unit })));
}

/** Per-unit view of the key points. Ranges whose units no longer exist are skipped. */
export function unitNotes(
  segments: readonly Segment[],
  units: UnitsBySegment,
  result: AnalyzeResult | null,
): Map<string, UnitNote> {
  const notes = new Map<string, UnitNote>();
  if (!result) return notes;
  const keys = orderedKeys(segments, units);
  const index = new Map(keys.map((k, i) => [k, i]));
  for (const h of result.highlights) {
    const a = index.get(unitKey(h.from));
    const b = index.get(unitKey(h.to));
    if (a === undefined || b === undefined || a > b) continue;
    for (let i = a; i <= b; i++) notes.set(keys[i]!, { highlight: h, last: i === b });
  }
  return notes;
}
