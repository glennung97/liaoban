import { describe, expect, it } from "vitest";
import type { AnalyzeResult } from "../../server/llm/types.ts";
import type { Segment } from "../types.ts";
import { unitNotes, unitsBySegment } from "./annotations.ts";

const seg = (id: string, text: string, startMs = 0): Segment => ({
  id,
  sessionId: "s",
  textRaw: text,
  text,
  words: [],
  startMs,
  endMs: startMs,
});

const result = (r: Partial<AnalyzeResult>): AnalyzeResult => ({
  highlights: [],
  terms: [],
  provider: "openai",
  model: "gpt-6-luna",
  usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
  billing: "api_key",
  segmentCount: 0,
  ...r,
});

// a: Eh bro, | lo jadi ikut nggak? | b: Jadi dong, | abis jam dua.
const segments = [seg("a", "Eh bro, lo jadi ikut nggak?", 1000), seg("b", "Jadi dong, abis jam dua.", 5000)];
const units = unitsBySegment(segments);
const ref = (segmentId: string, unit: number) => ({ segmentId, unit });
const res = result({ highlights: [{ from: ref("a", 1), to: ref("b", 0), importance: 2, reason: "問要不要去" }] });

describe("unit notes", () => {
  it("splits segments into units", () => {
    expect(units.get("a")).toEqual(["Eh bro, ", "lo jadi ikut nggak?"]);
  });

  it("marks every unit in a range and flags the last one, across segments", () => {
    const n = unitNotes(segments, units, res);
    expect(n.get("a:0")).toBeUndefined();
    expect(n.get("a:1")?.last).toBe(false);
    expect(n.get("b:0")?.last).toBe(true);
    expect(n.get("b:1")).toBeUndefined();
  });

  it("skips ranges whose units are gone", () => {
    expect(unitNotes([segments[1]!], unitsBySegment([segments[1]!]), res).size).toBe(0);
  });
});
