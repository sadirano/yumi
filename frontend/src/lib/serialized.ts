// Which content "needs a counter" is derived from tags: an item is serialized
// (anime episodes, manga chapters, …) if it carries one of these marker tags.
// Editable by the user and persisted locally; defaults cover the common cases.
const KEY = "serialized-tags";
const DEFAULT = ["source:anime", "source:manga"];

function normalize(list: string[]): string[] {
  return [...new Set(list.map(s => s.trim().toLowerCase()).filter(Boolean))];
}

export function getSerializedTags(): string[] {
  const raw = localStorage.getItem(KEY);
  if (raw == null) return DEFAULT;
  const list = normalize(raw.split(","));
  return list.length ? list : DEFAULT;
}

export function setSerializedTags(list: string[]): void {
  localStorage.setItem(KEY, normalize(list).join(","));
}

/** True when any of the item's tags is a configured serialized marker. */
export function isSerialized(tagNames: string[]): boolean {
  const markers = new Set(getSerializedTags());
  return tagNames.some(t => markers.has(t.toLowerCase()));
}
