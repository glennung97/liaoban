import type { TermResult } from "../../server/llm/types.ts";
import type { Term } from "../types.ts";

export const termKey = (name: string) => name.trim().toLowerCase();

/**
 * Adds the terms from one analysis to the ones already known. The model only
 * lists terms from the newest part of the transcript, so earlier ones are kept;
 * a term seen again gets its newer gist and any new spellings, and keeps its photo.
 */
export function mergeTerms(known: readonly Term[], incoming: readonly TermResult[], now = Date.now()): Term[] {
  const out = known.map((t) => ({ ...t }));
  const index = new Map(out.map((t, i) => [t.key, i]));
  for (const t of incoming) {
    const key = termKey(t.name);
    const i = index.get(key);
    if (i === undefined) {
      index.set(key, out.length);
      out.push({ ...t, key, firstSeen: now });
      continue;
    }
    const prev = out[i]!;
    out[i] = {
      ...prev,
      kind: t.kind,
      zh: t.zh || prev.zh,
      gist: t.gist || prev.gist,
      wiki: t.wiki || prev.wiki,
      mentions: [...new Set([...prev.mentions, ...t.mentions])],
      // A different article means the old photo may be of someone else.
      ...(t.wiki && t.wiki !== prev.wiki ? { photo: undefined } : {}),
    };
  }
  return out;
}

export type TextPiece = { text: string; termKey?: string };

const WORDISH = /[\p{L}\p{N}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** A letter or digit outside CJK: such a mention must not start or end inside a word. */
const needsBoundary = (c: string | undefined) => c !== undefined && WORDISH.test(c) && !CJK.test(c);

/**
 * Splits text into plain pieces and term mentions. Matching ignores case;
 * longer mentions win, and Latin-script mentions only match whole words
 * ("Jokowi" not inside "Jokowinya" unless that spelling is listed too).
 */
export function splitByTerms(text: string, terms: readonly Pick<Term, "key" | "mentions">[]): TextPiece[] {
  const lower = text.toLowerCase();
  // toLowerCase keeps the length for the scripts we see; if not, skip matching.
  if (lower.length !== text.length || terms.length === 0) return [{ text }];

  const candidates = terms
    .flatMap((t) => t.mentions.map((m) => ({ key: t.key, m: m.toLowerCase() })))
    .filter((c) => c.m.length > 0)
    .sort((a, b) => b.m.length - a.m.length);

  const taken: { start: number; end: number; key: string }[] = [];
  for (const { key, m } of candidates) {
    for (let at = lower.indexOf(m); at !== -1; at = lower.indexOf(m, at + 1)) {
      const end = at + m.length;
      if (needsBoundary(m[0]) && needsBoundary(text[at - 1])) continue;
      if (needsBoundary(m[m.length - 1]) && needsBoundary(text[end])) continue;
      if (taken.some((r) => at < r.end && end > r.start)) continue;
      taken.push({ start: at, end, key });
    }
  }
  if (taken.length === 0) return [{ text }];

  taken.sort((a, b) => a.start - b.start);
  const pieces: TextPiece[] = [];
  let pos = 0;
  for (const r of taken) {
    if (r.start > pos) pieces.push({ text: text.slice(pos, r.start) });
    pieces.push({ text: text.slice(r.start, r.end), termKey: r.key });
    pos = r.end;
  }
  if (pos < text.length) pieces.push({ text: text.slice(pos) });
  return pieces;
}

export const KIND_LABEL: Record<Term["kind"], string> = {
  person: "人物",
  topic: "時事",
  place: "地點",
  org: "組織",
  slang: "用語",
  question: "Luna 幫你查",
  other: "其他",
};
