import { describe, expect, it } from "vitest";
import {
  addSegment,
  buildSegment,
  emptyTranscript,
  newestChars,
  setPartial,
  tailText,
  toAbsoluteWords,
  type RawWord,
} from "./transcript.ts";

describe("newestChars", () => {
  it("marks only appended characters as new", () => {
    const prev = "今天我們";
    const next = "今天我們要拍";
    expect(next.slice(newestChars(prev, next))).toBe("要拍");
  });

  it("starts the highlight at the first revised character", () => {
    const prev = "今天我門要";
    const next = "今天我們要拍這個";
    expect(next.slice(newestChars(prev, next))).toBe("們要拍這個");
  });

  it("treats everything as new after a reset", () => {
    expect(newestChars("", "hello")).toBe(0);
  });

  it("handles a shorter revision", () => {
    const next = "今天我";
    expect(next.slice(newestChars("今天我們要", next))).toBe("");
  });

  it("works with mixed English and Chinese", () => {
    const prev = "拍這個 vid";
    const next = "拍這個 video，用";
    expect(next.slice(newestChars(prev, next))).toBe("eo，用");
  });

  it("does not split characters outside the BMP", () => {
    const prev = "𠮷a";
    const next = "𠮷b";
    expect(next.slice(newestChars(prev, next))).toBe("b");
  });
});

describe("setPartial / addSegment", () => {
  it("tracks fresh characters and bumps the revision", () => {
    let s = setPartial(emptyTranscript, "今天");
    s = setPartial(s, "今天我們");
    expect(s.partial).toBe("今天我們");
    expect(s.partial.slice(s.freshFrom)).toBe("我們");
    expect(s.partialRev).toBe(2);
    expect(setPartial(s, "今天我們")).toBe(s);
  });

  it("committing a segment appends it and clears the partial", () => {
    const seg = buildSegment({
      id: "a",
      sessionId: "s1",
      lang: "zh",
      textRaw: "今天",
      text: "今天",
      words: [{ text: "今天", startMs: 1000, endMs: 1500 }],
      fallbackMs: 0,
    });
    const s = addSegment(setPartial(emptyTranscript, "今天"), seg);
    expect(s.segments).toEqual([seg]);
    expect(s.partial).toBe("");
    expect(s.freshFrom).toBe(0);
  });
});

describe("toAbsoluteWords", () => {
  const origin = Date.UTC(2026, 9, 11, 2, 0, 0);

  it("converts word seconds to absolute epoch ms and drops spacing", () => {
    const raw: RawWord[] = [
      { text: "hello", start: 1.25, end: 1.6, type: "word" },
      { text: " ", start: 1.6, end: 1.7, type: "spacing" },
      { text: "world", start: 1.7, end: 2.05, type: "word" },
    ];
    expect(toAbsoluteWords(raw, origin)).toEqual([
      { text: "hello", startMs: origin + 1250, endMs: origin + 1600 },
      { text: "world", startMs: origin + 1700, endMs: origin + 2050 },
    ]);
  });

  it("fills in missing timings from the previous word", () => {
    const raw: RawWord[] = [
      { text: "a", start: 0.5, end: 0.8, type: "word" },
      { text: "b", type: "word" },
    ];
    expect(toAbsoluteWords(raw, origin)[1]).toEqual({ text: "b", startMs: origin + 800, endMs: origin + 800 });
  });

  it("segment start/end come from the first and last word", () => {
    const words = toAbsoluteWords(
      [
        { text: "a", start: 2, end: 2.5, type: "word" },
        { text: "b", start: 3, end: 3.5, type: "word" },
      ],
      origin,
    );
    const seg = buildSegment({ id: "x", sessionId: "s", textRaw: "a b", text: "a b", words, fallbackMs: 0 });
    expect(seg.startMs).toBe(origin + 2000);
    expect(seg.endMs).toBe(origin + 3500);
    expect(seg.lang).toBeUndefined();
  });

  it("segment without words uses the fallback time", () => {
    const seg = buildSegment({ id: "x", sessionId: "s", textRaw: "", text: "", words: [], fallbackMs: 42 });
    expect([seg.startMs, seg.endMs]).toEqual([42, 42]);
  });
});

describe("tailText", () => {
  it("returns the last N characters of raw text", () => {
    const mk = (t: string) =>
      buildSegment({ id: t, sessionId: "s", textRaw: t, text: t, words: [], fallbackMs: 0 });
    expect(tailText([mk("一二三"), mk("四五")], 4)).toBe("三 四五");
  });
});
