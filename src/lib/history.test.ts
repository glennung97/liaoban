import { describe, expect, it } from "vitest";
import type { Conversation } from "../types.ts";
import { deleteConversation, listHistory, loadConversation, saveConversation, type Store } from "./history.ts";

function memoryStore(limit = Infinity): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      const size = [...data].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0) + v.length;
      if (size > limit) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
}

const conv = (id: string, startedAt: number, text = "Halo"): Conversation => ({
  id,
  startedAt,
  updatedAt: startedAt + 60_000,
  lang: "id",
  segments: [
    { id: "s", sessionId: "x", textRaw: text, text, words: [{ text: "w", startMs: 0, endMs: 1 }], startMs: startedAt, endMs: startedAt },
  ],
  analysis: null,
  terms: [],
  live: [{ at: startedAt, title: "閒聊", now: "", points: [], questions: [] }],
  explanations: {},
});

describe("history", () => {
  it("saves, lists newest first and loads conversations without word timings", () => {
    const store = memoryStore();
    saveConversation(conv("a", 1000), store);
    saveConversation(conv("b", 2000), store);
    saveConversation(conv("a", 1000, "Halo lagi"), store); // update, not a duplicate
    expect(listHistory(store).map((e) => [e.id, e.title, e.preview])).toEqual([
      ["b", "閒聊", "Halo"],
      ["a", "閒聊", "Halo lagi"],
    ]);
    expect(loadConversation("a", store)?.segments[0]?.words).toEqual([]);
  });

  it("deletes a conversation and its index entry", () => {
    const store = memoryStore();
    saveConversation(conv("a", 1000), store);
    deleteConversation("a", store);
    expect(listHistory(store)).toEqual([]);
    expect(loadConversation("a", store)).toBeNull();
  });

  it("drops the oldest conversations when storage is full", () => {
    const one = JSON.stringify(conv("x", 0, "y".repeat(400))).length;
    const store = memoryStore(one * 2.6);
    saveConversation(conv("old", 1000, "y".repeat(400)), store);
    saveConversation(conv("mid", 2000, "y".repeat(400)), store);
    expect(saveConversation(conv("new", 3000, "y".repeat(400)), store)).toBe(true);
    expect(listHistory(store).map((e) => e.id)).toEqual(["new", "mid"]);
    expect(loadConversation("old", store)).toBeNull();
  });

  it("copes with missing or broken storage", () => {
    const store = memoryStore();
    store.setItem("liaoban.history", "not json");
    expect(listHistory(store)).toEqual([]);
    expect(saveConversation(conv("a", 1), null)).toBe(false);
  });
});
