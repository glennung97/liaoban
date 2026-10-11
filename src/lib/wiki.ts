import type { Photo } from "../types.ts";

// Small portrait for a person, from Wikipedia's public API (CORS via origin=*).
// The browser asks Wikipedia directly; only the person's name is sent.

type QueryResponse = {
  query?: {
    pages?: Record<string, { title: string; fullurl?: string; thumbnail?: { source: string } }>;
  };
};

async function searchWiki(lang: string, q: string): Promise<Photo | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: q,
    gsrlimit: "1",
    prop: "pageimages|info",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: "160",
  });
  const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as QueryResponse;
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page?.thumbnail) return null;
  return { thumb: page.thumbnail.source, title: page.title, url: page.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}` };
}

/**
 * Looks the person up on English, then Indonesian, then Chinese Wikipedia and
 * returns the top result's thumbnail. The page title is shown with the photo,
 * so a wrong match is visible.
 */
export async function lookupPhoto(name: string): Promise<Photo | null> {
  for (const lang of ["en", "id", "zh"]) {
    try {
      const photo = await searchWiki(lang, name);
      if (photo) return photo;
    } catch {
      // offline or blocked; try the next one
    }
  }
  return null;
}
