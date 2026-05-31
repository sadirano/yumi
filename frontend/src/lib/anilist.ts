// Build the anilist.co URL for a stored media id. AniList ids are scoped to a
// media type, so we derive anime vs manga from the item's tags (source:manga ->
// manga; otherwise anime, which is the common case and a safe default).
export function anilistUrl(id: number, tagNames: string[]): string {
  const type = tagNames.some(t => t.toLowerCase() === "source:manga") ? "manga" : "anime";
  return `https://anilist.co/${type}/${id}`;
}
