import { describe, expect, it } from "vitest";
import type { Term } from "../types.ts";
import { mergeTerms, splitByTerms, termKey } from "./terms.ts";

const term = (name: string, mentions: string[], extra: Partial<Term> = {}): Term => ({
  name,
  zh: "",
  kind: "person",
  mentions,
  gist: "",
  wiki: "",
  key: termKey(name),
  firstSeen: 0,
  ...extra,
});

describe("splitByTerms", () => {
  const terms = [
    term("Joko Widodo", ["Jokowi", "Pak Jokowi"]),
    term("Jokowi 假學歷爭議", ["ijazah", "ijazahnya"], { kind: "topic" }),
    term("佐科威", ["佐科威"]),
  ];

  it("marks every mention, preferring the longest, ignoring case", () => {
    expect(splitByTerms("Itu loh, IJAZAHNYA pak jokowi, katanya palsu.", terms)).toEqual([
      { text: "Itu loh, " },
      { text: "IJAZAHNYA", termKey: "jokowi 假學歷爭議" },
      { text: " " },
      { text: "pak jokowi", termKey: "joko widodo" },
      { text: ", katanya palsu." },
    ]);
  });

  it("only matches whole words in Latin script", () => {
    expect(splitByTerms("Jokowiisme dan ijazahku", terms)).toEqual([{ text: "Jokowiisme dan ijazahku" }]);
  });

  it("matches inside Chinese text without word boundaries", () => {
    expect(splitByTerms("他說佐科威的學歷", terms)).toEqual([
      { text: "他說" },
      { text: "佐科威", termKey: "佐科威" },
      { text: "的學歷" },
    ]);
  });

  it("returns the text whole when nothing matches", () => {
    expect(splitByTerms("Macet banget", terms)).toEqual([{ text: "Macet banget" }]);
    expect(splitByTerms("Macet", [])).toEqual([{ text: "Macet" }]);
  });
});

describe("mergeTerms", () => {
  it("adds new terms and updates known ones, keeping their photo and first-seen time", () => {
    const photo = { thumb: "t.jpg", title: "Joko Widodo", url: "u" };
    const known = [term("Joko Widodo", ["Jokowi"], { gist: "舊", wiki: "Joko Widodo", photo, firstSeen: 1 })];
    const out = mergeTerms(
      known,
      [
        { name: "joko widodo", zh: "佐科威", kind: "person", mentions: ["Pak Jokowi"], gist: "前總統", wiki: "Joko Widodo" },
        { name: "UGM", zh: "", kind: "org", mentions: ["UGM"], gist: "大學", wiki: "" },
      ],
      5,
    );
    expect(out[0]).toMatchObject({ name: "Joko Widodo", zh: "佐科威", gist: "前總統", mentions: ["Jokowi", "Pak Jokowi"], photo, firstSeen: 1 });
    expect(out[1]).toMatchObject({ key: "ugm", firstSeen: 5 });
    expect(known[0]!.mentions).toEqual(["Jokowi"]); // not mutated
  });

  it("looks the photo up again when the Wikipedia article changes", () => {
    const known = [term("Budi", ["Budi"], { wiki: "Budi A", photo: null })];
    const out = mergeTerms(known, [{ name: "Budi", zh: "", kind: "person", mentions: [], gist: "", wiki: "Budi B" }]);
    expect(out[0]!.photo).toBeUndefined();
  });
});
