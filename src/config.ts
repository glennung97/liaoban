// Language presets sent to ElevenLabs at each connect. `primary` biases
// recognition; `secondary` limits language detection to that set.

// Casual Jakarta words speech-to-text may not spell well on its own: Hokkien
// money slang and loanwords, Betawi/gaul slang and a few Javanese words.
// Sent as keyterms with the Indonesian preset, after the user's own terms.
export const JAKARTA_KEYTERMS = [
  "gue",
  "lo",
  "nggak",
  "kagak",
  "banget",
  "doang",
  "ngapain",
  "cuan",
  "gocap",
  "cepek",
  "gopek",
  "seceng",
  "goceng",
  "ceban",
  "goban",
  "cetiau",
  "cincai",
  "kongkow",
  "hoki",
  "bokap",
  "nyokap",
  "mager",
  "gabut",
  "baper",
  "santuy",
  "kepo",
  "gercep",
  "gokil",
  "piye",
  "monggo",
  "nggih",
];

export type LangPreset = "auto" | "zh" | "id" | "nl";

export type LangConfig = {
  label: string;
  primary?: string;
  secondary: string[];
  keyterms: string[];
};

export const LANG_PRESETS: Record<LangPreset, LangConfig> = {
  // ElevenLabs detects the language itself; the default.
  auto: { label: "自動偵測 Auto", secondary: [], keyterms: [] },
  zh: { label: "中文 · English", primary: "zh", secondary: ["en"], keyterms: [] },
  // Jakarta speech mixes in English and Javanese; Hokkien words come through as Indonesian.
  id: { label: "印尼語 Bahasa Indonesia", primary: "id", secondary: ["en", "jv"], keyterms: JAKARTA_KEYTERMS },
  nl: { label: "荷蘭語 Nederlands", primary: "nl", secondary: ["en"], keyterms: [] },
};

export const MODEL_ID = "scribe_v2_realtime";

// Characters of earlier transcript passed as `previousText` on reconnect.
export const PREVIOUS_TEXT_CHARS = 200;

// ElevenLabs limits: at most 50 terms, each at most 20 characters.
export function validKeyterms(terms: readonly string[]): string[] {
  return [...new Set(terms.map((t) => t.trim()))].filter((t) => t.length > 0 && [...t].length <= 20).slice(0, 50);
}
