import { describe, expect, it } from "vitest";
import { splitUnits } from "./units.ts";

describe("splitUnits", () => {
  it("splits at Chinese punctuation and keeps it with the clause", () => {
    expect(splitUnits("Hello，今天呢，我們要去夜市吃晚餐。")).toEqual([
      "Hello，",
      "今天呢，",
      "我們要去夜市吃晚餐。",
    ]);
  });

  it("separates a restart marked with …… and ——", () => {
    expect(splitUnits("我們先去……欸……先去——先去捷運站，")).toEqual([
      "我們先去……",
      "欸……",
      "先去——",
      "先去捷運站，",
    ]);
  });

  it("splits a restart marked with a hyphen between CJK characters", () => {
    expect(splitUnits("搭到台北車-車站再轉車，")).toEqual(["搭到台北車-", "車站再轉車，"]);
  });

  it("does not split English hyphens, decimals or abbreviations", () => {
    expect(splitUnits("A check-in at 3.5 p.m. works, right?")).toEqual(["A check-in at 3.5 p.m. ", "works, ", "right?"]);
  });

  it("keeps closing quotes and brackets with the clause", () => {
    expect(splitUnits("他說「好。」然後《我們又來拍一個 video》。")).toEqual(["他說「好。」", "然後《我們又來拍一個 video》。"]);
  });

  it("does not split at 、 enumerations", () => {
    expect(splitUnits("1、2、3。")).toEqual(["1、2、3。"]);
  });

  it("keeps text without punctuation as one unit, and is lossless", () => {
    expect(splitUnits("沒有標點的一句話")).toEqual(["沒有標點的一句話"]);
    expect(splitUnits("")).toEqual([]);
    const t = "我，我是一個很有趣的小孩子。那榮錯呢，是一個……嗯……沒有趣的。We can use this for every interview, 不管是中文。";
    expect(splitUnits(t).join("")).toBe(t);
  });
});
