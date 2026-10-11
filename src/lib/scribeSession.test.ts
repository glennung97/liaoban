import { describe, expect, it } from "vitest";
import { pcmChunkMs } from "./scribeSession.ts";

describe("pcmChunkMs", () => {
  it("measures 16 kHz PCM16 chunks from their base64 length", () => {
    const b64 = (bytes: number) => Buffer.alloc(bytes).toString("base64");
    expect(pcmChunkMs(b64(3200))).toBe(100);
    expect(pcmChunkMs(b64(4096))).toBe(128);
    expect(pcmChunkMs(b64(3201))).toBeCloseTo(100.03, 2);
    expect(pcmChunkMs("")).toBe(0);
  });
});
