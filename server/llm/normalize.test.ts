import { describe, expect, it } from "vitest";
import { explanationLines, normalizeHighlights, normalizeLive, normalizeTerms, uniqueSources } from "./normalize.ts";
import {
  analyzeSystemPrompt,
  analyzeTask,
  briefTask,
  explainTask,
  liveSystemPrompt,
  liveTask,
  plainTranscript,
  unitTranscript,
} from "./prompt.ts";

// u1 u2 | u3 u4 u5 | u6
const segs = [
  { id: "A", units: ["一，", "二。"] },
  { id: "B", units: ["三，", "四……", "五。"] },
  { id: "C", units: ["六。"] },
];
const ref = (segmentId: string, unit: number) => ({ segmentId, unit });

describe("normalizeHighlights", () => {
  it("maps unit ranges back to segment + unit, across segments", () => {
    const out = normalizeHighlights([{ from: "u5", to: "u6", importance: 2, reason: "約定時間" }], segs);
    expect(out).toEqual([{ from: ref("B", 2), to: ref("C", 0), importance: 2, reason: "約定時間" }]);
  });

  it("treats a missing `to` as a single unit and accepts [u3] / U3", () => {
    const out = normalizeHighlights([{ from: "[u3]", to: "", importance: 1, reason: "" }], segs);
    expect(out[0]).toMatchObject({ from: ref("B", 0), to: ref("B", 0) });
  });

  it("merges back-to-back ranges with the same reason into one", () => {
    const out = normalizeHighlights(
      [
        { from: "u4", to: "u5", importance: 1, reason: "聊新歌" },
        { from: "u1", to: "u2", importance: 1, reason: "聊新歌" },
        { from: "u3", to: "u3", importance: 2, reason: "聊新歌" },
        { from: "u6", to: "u6", importance: 1, reason: "約時間" },
      ],
      segs,
    );
    expect(out).toEqual([
      { from: ref("A", 0), to: ref("B", 2), importance: 2, reason: "聊新歌" },
      { from: ref("C", 0), to: ref("C", 0), importance: 1, reason: "約時間" },
    ]);
  });

  it("drops unknown IDs, backwards ranges and overlaps; clamps importance", () => {
    const out = normalizeHighlights(
      [
        { from: "u9", to: "u9", importance: 1, reason: "unknown" },
        { from: "u3", to: "u2", importance: 1, reason: "backwards" },
        { from: "u3", to: "u4", importance: 9, reason: "ok" },
        { from: "u4", to: "u5", importance: 1, reason: "overlap" },
        { from: "u6", to: "u6", importance: 0, reason: "low" },
      ],
      segs,
    );
    expect(out.map((h) => [h.reason, h.importance])).toEqual([
      ["ok", 3],
      ["low", 1],
    ]);
  });
});

describe("normalizeTerms", () => {
  it("trims, drops nameless terms and one-letter mentions, merges duplicates", () => {
    const out = normalizeTerms([
      { name: " Joko Widodo ", zh: " 佐科威 ", kind: "person", mentions: ["Jokowi", "J"], gist: " 前總統 ", wiki: "Joko Widodo" },
      { name: "joko widodo", zh: "", kind: "person", mentions: ["Pak Jokowi"], gist: "", wiki: "" },
      { name: "  ", zh: "", kind: "topic", mentions: ["x"], gist: "", wiki: "" },
      { name: "印尼示威", zh: "印尼示威", kind: "topic", mentions: ["demo"], gist: "", wiki: "" },
    ]);
    expect(out).toEqual([
      { name: "Joko Widodo", zh: "佐科威", kind: "person", mentions: ["Jokowi", "Pak Jokowi"], gist: "前總統", wiki: "Joko Widodo" },
      { name: "印尼示威", zh: "", kind: "topic", mentions: ["demo"], gist: "", wiki: "" },
    ]);
  });
});

describe("normalizeLive", () => {
  it("trims and drops empty questions", () => {
    const out = normalizeLive({
      title: " 司機聊天 ",
      now: " 在聊塞車 ",
      points: ["", " 要走收費道路 "],
      questions: [
        { angle: " 追問 ", say: " Lewat tol? ", meaning: " 走收費道路？ " },
        { angle: "回應", say: " ", meaning: "空的" },
      ],
    });
    expect(out).toEqual({
      title: "司機聊天",
      now: "在聊塞車",
      points: ["要走收費道路"],
      questions: [{ angle: "追問", say: "Lewat tol?", meaning: "走收費道路？" }],
    });
  });
});

describe("explanation text", () => {
  it("splits lines and strips bullets, markdown links and citation marks", () => {
    expect(
      explanationLines(
        "- **Jokowi** 是前總統 ([kompas.com](https://kompas.com/a))\n\n* 2025 年[提告](https://x.y)。【4†source】\n2. 第三點",
      ),
    ).toEqual(["Jokowi 是前總統", "2025 年提告。", "第三點"]);
  });

  it("keeps the first few distinct http(s) sources", () => {
    expect(
      uniqueSources([
        { title: "A", url: "https://a.com/1" },
        { title: "A again", url: "https://a.com/1" },
        { title: "", url: "https://b.com/2" },
        { title: "bad", url: "javascript:alert(1)" },
      ]),
    ).toEqual([
      { title: "A", url: "https://a.com/1" },
      { title: "b.com", url: "https://b.com/2" },
    ]);
  });
});

describe("prompts", () => {
  it("numbers units in order with a blank line between segments", () => {
    expect(unitTranscript(segs)).toBe("u1 一，\nu2 二。\n\nu3 三，\nu4 四……\nu5 五。\n\nu6 六。");
  });

  it("writes one line per segment with its time", () => {
    expect(plainTranscript([{ units: ["Eh bro, ", "lo jadi\nikut?"], at: "12:00:01" }, { units: ["好。"] }])).toBe(
      "[12:00:01] Eh bro, lo jadi ikut?\n好。",
    );
  });

  it("includes the user's context, or says there is none", () => {
    expect(analyzeSystemPrompt("在雅加達跟同事吃飯")).toContain("在雅加達跟同事吃飯");
    expect(liveSystemPrompt("  ")).toContain("(nothing given");
  });

  it("asks for terms from the newest units only", () => {
    expect(analyzeTask(100)).toContain("u61 to u100");
    expect(analyzeTask(10)).toContain("u1 to u10");
  });

  it("knows Jakarta slang, local issues and the speakers' register", () => {
    expect(analyzeSystemPrompt("")).toContain("gocap 50");
    expect(analyzeSystemPrompt("")).toContain("diploma controversy");
    expect(liveTask()).toContain("matching their register");
    expect(liveTask()).toContain("換個方向");
    expect(liveTask()).toContain("at most about 8 words");
  });

  it("keeps names in their original spelling and finds questions to look up", () => {
    const p = analyzeSystemPrompt("");
    expect(p).toContain("never a Chinese transliteration");
    expect(p).toContain("Jason Mraz 最新的歌叫什麼？");
    expect(p).toContain("At most about one unit in eight");
    expect(explainTask({ name: "Jason Mraz 最新的歌叫什麼？", kind: "question", mentions: ["lagu barunya"] })).toContain(
      "Answer this question",
    );
    expect(briefTask("background")).toContain("Not word definitions");
  });

  it("explains a term with the words actually said", () => {
    const t = explainTask({ name: "Jokowi 假學歷爭議", kind: "topic", mentions: ["ijazah"], gist: "學歷造假指控" });
    expect(t).toContain("ijazah");
    expect(t).toContain("what is happening now");
  });
});
