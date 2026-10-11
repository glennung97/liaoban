import type { Conversation } from "../types.ts";

// Past conversations, kept in this browser's localStorage (not synced between
// devices). Each conversation is one key; a small index lists them for the
// history screen. Word timings aren't needed once saved, so they're dropped.

const INDEX_KEY = "liaoban.history";
const convKey = (id: string) => `liaoban.conv.${id}`;

export type HistoryEntry = {
  id: string;
  startedAt: number;
  updatedAt: number;
  title: string;
  /** First words, for conversations without a title yet. */
  preview: string;
  segmentCount: number;
  termNames: string[];
};

export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): Store | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function listHistory(store = defaultStore()): HistoryEntry[] {
  try {
    const list = JSON.parse(store?.getItem(INDEX_KEY) ?? "[]") as HistoryEntry[];
    return Array.isArray(list) ? list.sort((a, b) => b.startedAt - a.startedAt) : [];
  } catch {
    return [];
  }
}

export function loadConversation(id: string, store = defaultStore()): Conversation | null {
  try {
    const raw = store?.getItem(convKey(id));
    return raw ? (JSON.parse(raw) as Conversation) : null;
  } catch {
    return null;
  }
}

export function entryOf(c: Conversation): HistoryEntry {
  return {
    id: c.id,
    startedAt: c.startedAt,
    updatedAt: c.updatedAt,
    title: c.live.at(-1)?.title ?? "",
    preview: [...c.segments.map((s) => s.text).join(" ")].slice(0, 60).join(""),
    segmentCount: c.segments.length,
    termNames: c.terms.slice(0, 6).map((t) => t.name),
  };
}

/**
 * Saves a conversation and updates the index. If storage is full, drops the
 * oldest conversations until it fits. Returns false if it still can't be saved.
 */
export function saveConversation(c: Conversation, store = defaultStore()): boolean {
  if (!store) return false;
  const body = JSON.stringify({ ...c, segments: c.segments.map((s) => ({ ...s, words: [] })) });
  let index = listHistory(store).filter((e) => e.id !== c.id);
  for (;;) {
    try {
      store.setItem(convKey(c.id), body);
      store.setItem(INDEX_KEY, JSON.stringify([entryOf(c), ...index]));
      return true;
    } catch {
      const oldest = index.at(-1);
      if (!oldest) return false;
      index = index.slice(0, -1);
      try {
        store.removeItem(convKey(oldest.id));
      } catch {
        // keep going; the index no longer lists it
      }
    }
  }
}

export function deleteConversation(id: string, store = defaultStore()): void {
  if (!store) return;
  try {
    store.removeItem(convKey(id));
    store.setItem(INDEX_KEY, JSON.stringify(listHistory(store).filter((e) => e.id !== id)));
  } catch {
    // storage unavailable
  }
}
