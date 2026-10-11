import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyzeScheduler } from "./analyzer.ts";

describe("AnalyzeScheduler", () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  function setup(callMs = 2000) {
    const run = vi.fn(() => new Promise<void>((r) => setTimeout(r, callMs)));
    return { run, s: new AnalyzeScheduler(run, 10_000, () => Date.now()) };
  }

  it("runs the first call right away", async () => {
    const { run, s } = setup();
    s.notify();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("calls at most once every 10 s and coalesces bursts", async () => {
    const { run, s } = setup();
    s.notify();
    await vi.advanceTimersByTimeAsync(0);
    s.notify();
    s.notify();
    s.notify();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never overlaps calls, even if one is slower than the interval", async () => {
    const { run, s } = setup(15_000);
    s.notify();
    await vi.advanceTimersByTimeAsync(0);
    s.notify();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(run).toHaveBeenCalledTimes(1);
    // The first call ends at 15 s; the queued one starts on the next tick.
    await vi.advanceTimersByTimeAsync(5);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps going after a failed call", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(undefined);
    const s = new AnalyzeScheduler(run, 10_000, () => Date.now());
    s.notify();
    await vi.advanceTimersByTimeAsync(0);
    s.notify();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels a scheduled call", async () => {
    const { run, s } = setup();
    s.notify();
    await vi.advanceTimersByTimeAsync(0);
    s.notify();
    s.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("AnalyzeScheduler for the recap", () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  it("holdOff makes the first call wait a full interval", async () => {
    const run = vi.fn(() => Promise.resolve());
    const s = new AnalyzeScheduler(run, 30_000, () => Date.now());
    s.holdOff();
    await vi.advanceTimersByTimeAsync(5_000);
    s.notify();
    await vi.advanceTimersByTimeAsync(24_999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runNow ignores the interval", async () => {
    const run = vi.fn(() => Promise.resolve());
    const s = new AnalyzeScheduler(run, 30_000, () => Date.now());
    s.notify();
    await vi.advanceTimersByTimeAsync(0);
    s.runNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("uses a changed interval for the next call", async () => {
    const run = vi.fn(() => Promise.resolve());
    const s = new AnalyzeScheduler(run, 30_000, () => Date.now());
    s.notify();
    await vi.advanceTimersByTimeAsync(0);
    s.intervalMs = 15_000;
    s.notify();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("keyterms", () => {
  it("parses keyterms from lines or commas, dropping duplicates and long terms", async () => {
    const { parseKeyterms } = await import("./analyzer.ts");
    expect(parseKeyterms("Budi\nPIK，Grab、Gojek, KPOP;Budi\n\n這是一個超過二十個字的關鍵詞一定會被拿掉喔對")).toEqual([
      "Budi",
      "PIK",
      "Grab",
      "Gojek",
      "KPOP",
    ]);
    expect(parseKeyterms(Array.from({ length: 60 }, (_, i) => `t${i}`).join("\n"))).toHaveLength(50);
  });
});
