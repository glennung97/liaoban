import { flattenUnits } from "./prompt.js";
import type { AnalyzeOutput, HighlightResult, LiveOutput, Source, TermResult } from "./types.js";

/**
 * Maps the model's unit IDs back to { segmentId, unit } and drops anything that
 * doesn't make sense (unknown IDs, backwards ranges, overlaps), so a model
 * mistake never reaches the UI.
 */
export function normalizeHighlights(
  highlights: AnalyzeOutput["highlights"],
  segments: readonly { id: string; units: readonly string[] }[],
): HighlightResult[] {
  const flat = flattenUnits(segments);
  const resolve = (id: string): number | undefined => {
    const m = /^\[?u(\d+)\]?$/i.exec(id.trim());
    if (!m) return undefined;
    const i = Number(m[1]) - 1;
    return i >= 0 && i < flat.length ? i : undefined;
  };

  const taken = new Set<number>();
  const ranges: { a: number; b: number; importance: 1 | 2 | 3; reason: string }[] = [];
  for (const h of highlights) {
    const a = resolve(h.from);
    const b = resolve(h.to) ?? a;
    if (a === undefined || b === undefined || a > b) continue;
    let free = true;
    for (let i = a; i <= b; i++) if (taken.has(i)) free = false;
    if (!free) continue;
    for (let i = a; i <= b; i++) taken.add(i);
    const importance = Math.min(3, Math.max(1, Math.round(h.importance))) as 1 | 2 | 3;
    ranges.push({ a, b, importance, reason: h.reason.trim() });
  }

  // Back-to-back ranges about the same thing read as one point.
  ranges.sort((x, y) => x.a - y.a);
  const merged: typeof ranges = [];
  for (const r of ranges) {
    const prev = merged.at(-1);
    if (prev && prev.b + 1 === r.a && prev.reason === r.reason) {
      prev.b = r.b;
      prev.importance = Math.max(prev.importance, r.importance) as 1 | 2 | 3;
    } else {
      merged.push({ ...r });
    }
  }
  return merged.map((r) => ({ from: flat[r.a]!.ref, to: flat[r.b]!.ref, importance: r.importance, reason: r.reason }));
}

const MAX_TERMS = 30;
const MAX_MENTIONS = 10;

/** Trims, drops nameless terms and merges duplicates (same name, any case). */
export function normalizeTerms(terms: AnalyzeOutput["terms"]): TermResult[] {
  const byKey = new Map<string, TermResult>();
  for (const t of terms) {
    const name = t.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const mentions = t.mentions.map((m) => m.trim()).filter((m) => [...m].length >= 2);
    const prev = byKey.get(key);
    if (prev) {
      prev.mentions = [...new Set([...prev.mentions, ...mentions])].slice(0, MAX_MENTIONS);
      continue;
    }
    if (byKey.size === MAX_TERMS) continue;
    const zh = t.zh.trim();
    byKey.set(key, {
      name,
      zh: zh === name ? "" : zh,
      kind: t.kind,
      mentions: [...new Set(mentions)].slice(0, MAX_MENTIONS),
      gist: t.gist.trim(),
      wiki: t.wiki.trim(),
    });
  }
  return [...byKey.values()];
}

export function normalizeLive(o: LiveOutput): LiveOutput {
  return {
    title: o.title.trim(),
    now: o.now.trim(),
    points: o.points.map((p) => p.trim()).filter(Boolean).slice(0, 4),
    questions: o.questions
      .map((q) => ({ angle: q.angle.trim(), say: q.say.trim(), meaning: q.meaning.trim() }))
      .filter((q) => q.say)
      .slice(0, 4),
  };
}

/**
 * Turns the explanation text into lines: drops bullets, markdown links and
 * citation marks the model adds despite being asked not to.
 */
export function explanationLines(text: string): string[] {
  return text
    .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "") // ([site](url))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) → text
    .replace(/【[^】]*†[^】]*】/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

/** First few distinct sources, by URL. */
export function uniqueSources(sources: readonly Source[], max = 3): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    if (!/^https?:\/\//.test(s.url) || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ title: s.title.trim() || new URL(s.url).hostname, url: s.url });
    if (out.length === max) break;
  }
  return out;
}
