// Splits committed text into clause-sized units at punctuation, so key points
// can cover part of a segment: one long segment often holds several thoughts,
// and units let the AI mark just the one that matters. Units joined back
// together equal the original text.

const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
const FULLWIDTH_BREAK = new Set(["，", "。", "！", "？", "；"]);
const ASCII_BREAK = new Set([",", ".", "!", "?", ";"]);
const RUN_BREAK = new Set(["…", "—"]); // break after a run of these
const CLOSERS = /[」』）》〉”’"')\]\s]/;

export function splitUnits(text: string): string[] {
  const chars = [...text];
  const units: string[] = [];
  let cur = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    const prev = chars[i - 1];
    const next = chars[i + 1];
    cur += c;

    let brk = false;
    if (FULLWIDTH_BREAK.has(c)) brk = true;
    // ASCII punctuation only before a space, a CJK character or the end (not 3.5, e.g., U.S.)
    else if (ASCII_BREAK.has(c)) brk = next === undefined || /\s/.test(next) || CJK.test(next);
    else if (RUN_BREAK.has(c)) brk = next !== c;
    // ElevenLabs marks a restart inside a word with a hyphen: 台北車-車站
    else if (c === "-") brk = prev !== undefined && next !== undefined && CJK.test(prev) && CJK.test(next);

    if (brk) {
      while (i + 1 < chars.length && CLOSERS.test(chars[i + 1]!)) cur += chars[++i]!;
      units.push(cur);
      cur = "";
    }
  }
  if (cur) units.push(cur);
  return units;
}
