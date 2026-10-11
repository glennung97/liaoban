import * as OpenCC from "opencc-js/cn2t";

// cn→tw: Simplified to Traditional characters with Taiwan glyph variants.
// It uses OpenCC's phrase dictionary only to pick the right character
// (头发→頭髮, 发展→發展, 后来→後來) and never swaps vocabulary, so the
// transcript stays true to what was said: 软件→軟件, not 軟體. The character
// count never changes, so partial highlighting and word timings stay aligned.
const toTw = OpenCC.Converter({ from: "cn", to: "tw" });

// ElevenLabs may return ISO-639-1 or ISO-639-3 codes.
const CHINESE_CODES = new Set(["zh", "zho", "chi", "cmn", "yue"]);

export function isChinese(lang: string | undefined): boolean {
  if (!lang) return false;
  return CHINESE_CODES.has(lang.toLowerCase().split(/[-_]/)[0] ?? "");
}

const KANA = /[぀-ヿ]/;
const HANGUL = /[가-힯]/;

/**
 * Partials carry no language code. Convert unless the text is clearly Japanese
 * or Korean, or the last committed language is known and not Chinese.
 */
export function shouldConvertPartial(text: string, lastLang: string | undefined): boolean {
  if (KANA.test(text) || HANGUL.test(text)) return false;
  return lastLang === undefined || isChinese(lastLang);
}

export function partialToTraditional(text: string, lastLang?: string): string {
  return shouldConvertPartial(text, lastLang) ? toTw(text) : text;
}

/** Committed text, only for Chinese. */
export function committedToTraditional(text: string, lang: string | undefined): string {
  return isChinese(lang) ? toTw(text) : text;
}

/**
 * Converts word texts while keeping each word's timing. Chinese words are often
 * single characters, so convert the whole run (giving the phrase dictionary
 * context) and slice it back onto the words.
 */
export function wordsToTraditional<W extends { text: string }>(words: W[], lang: string | undefined): W[] {
  if (!isChinese(lang)) return words;
  const joined = words.map((w) => w.text).join("");
  const chars = [...toTw(joined)];
  // Safety net: if a dictionary entry ever changes the length, convert word by word.
  if (chars.length !== [...joined].length) return words.map((w) => ({ ...w, text: toTw(w.text) }));
  let i = 0;
  return words.map((w) => {
    const n = [...w.text].length;
    const text = chars.slice(i, i + n).join("");
    i += n;
    return { ...w, text };
  });
}
