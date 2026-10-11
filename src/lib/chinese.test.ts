import { describe, expect, it } from "vitest";
import {
  committedToTraditional,
  isChinese,
  partialToTraditional,
  shouldConvertPartial,
  wordsToTraditional,
} from "./chinese.ts";

describe("isChinese", () => {
  it("accepts ISO-639-1 and -3 Chinese codes", () => {
    for (const c of ["zh", "zho", "cmn", "zh-TW", "ZH"]) expect(isChinese(c)).toBe(true);
    for (const c of ["en", "ja", "jpn", "ko", undefined]) expect(isChinese(c)).toBe(false);
  });
});

describe("conversion only for zh", () => {
  it("converts committed Chinese", () => {
    expect(committedToTraditional("今天我们要拍这个", "zh")).toBe("今天我們要拍這個");
  });

  it("leaves Japanese kanji unchanged", () => {
    expect(committedToTraditional("国の会社", "ja")).toBe("国の会社");
    expect(committedToTraditional("中国", "jpn")).toBe("中国");
  });

  it("leaves English unchanged", () => {
    expect(committedToTraditional("video software", "en")).toBe("video software");
  });

  it("partials: skip kana/hangul text and non-Chinese last language", () => {
    expect(shouldConvertPartial("国の", undefined)).toBe(false);
    expect(shouldConvertPartial("국가", undefined)).toBe(false);
    expect(shouldConvertPartial("国家", "ja")).toBe(false);
    expect(shouldConvertPartial("国家", undefined)).toBe(true);
    expect(partialToTraditional("国家", "zh")).toBe("國家");
  });

  it("partial conversion keeps the character count", () => {
    const s = "今天我们要拍这个video，用新的软件";
    expect([...partialToTraditional(s)].length).toBe([...s].length);
  });
});

describe("stays true to the spoken words", () => {
  it("converts characters without swapping vocabulary", () => {
    expect(committedToTraditional("今天我们要拍这个video，用新的软件", "zh")).toBe(
      "今天我們要拍這個video，用新的軟件",
    );
    expect(committedToTraditional("软体", "zh")).toBe("軟體");
    expect(committedToTraditional("视频", "zh")).toBe("視頻");
    expect(committedToTraditional("网络用户", "zh")).toBe("網絡用戶");
  });

  it("uses context to pick the right Traditional character", () => {
    expect(committedToTraditional("头发", "zh")).toBe("頭髮");
    expect(committedToTraditional("发展", "zh")).toBe("發展");
    expect(committedToTraditional("后来", "zh")).toBe("後來");
    expect(committedToTraditional("皇后", "zh")).toBe("皇后");
    expect(committedToTraditional("干杯", "zh")).toBe("乾杯");
  });

  it("leaves text that is already Traditional unchanged", () => {
    const s = "我們要測試一下新的軟體";
    expect(committedToTraditional(s, "zh")).toBe(s);
  });

  it("keeps word timings and uses context across single-character words", () => {
    const words = [
      { text: "头", startMs: 0, endMs: 100 },
      { text: "发", startMs: 100, endMs: 200 },
      { text: "软件", startMs: 200, endMs: 400 },
    ];
    expect(wordsToTraditional(words, "zh")).toEqual([
      { text: "頭", startMs: 0, endMs: 100 },
      { text: "髮", startMs: 100, endMs: 200 },
      { text: "軟件", startMs: 200, endMs: 400 },
    ]);
  });

  it("does not touch non-Chinese words", () => {
    const words = [{ text: "国", startMs: 0, endMs: 1 }];
    expect(wordsToTraditional(words, "ja")).toBe(words);
  });
});
