// Which content "needs a counter" is derived from tags: an item is serialized
// (anime episodes, manga chapters, …) if it carries one of these marker tags.
// The source of truth lives server-side (shared across devices); localStorage
// is a synchronous cache so cards/detail can read the rule during render.
import { api } from "../api/client";

const KEY = "serialized-tags";
const SETTING_KEY = "counter-tags";
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

/** Persist to the server AND the local cache. Await before reloading so the
 *  request isn't cancelled by the navigation. */
export async function saveSerializedTags(list: string[]): Promise<void> {
  const normalized = normalize(list);
  setSerializedTags(normalized);
  try {
    await api.putSetting(SETTING_KEY, normalized);
  } catch {
    // Offline/unreachable: the local cache still applies; the next device
    // boot that reaches the server will reconcile.
  }
}

/** Pull the server value into the local cache. Returns true when the cache
 *  changed (caller should reload so every card re-reads the rule). A missing
 *  server value is seeded from this device, so the first boot after upgrading
 *  publishes the existing local configuration. */
export async function syncSerializedTagsFromServer(): Promise<boolean> {
  try {
    const settings = await api.getSettings();
    const server = settings[SETTING_KEY];
    if (!Array.isArray(server)) {
      await api.putSetting(SETTING_KEY, getSerializedTags());
      return false;
    }
    const incoming = normalize(server.map(String));
    if (!incoming.length) return false;
    const current = getSerializedTags();
    if ([...incoming].sort().join(",") === [...current].sort().join(",")) return false;
    setSerializedTags(incoming);
    return true;
  } catch {
    return false; // offline: keep the cached rule
  }
}

/** True when any of the item's tags is a configured serialized marker. */
export function isSerialized(tagNames: string[]): boolean {
  const markers = new Set(getSerializedTags());
  return tagNames.some(t => markers.has(t.toLowerCase()));
}
