import { RECENT_PLAYED_CHANGED_EVENT } from "@/lib/ui-events";

const STORAGE_KEY = "polarr-recent-search-items";
const MAX = 12;

function emitRecentPlayedChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(RECENT_PLAYED_CHANGED_EVENT));
}

/** Tracks the user actually played — shown under Recent searches on mobile. */
export type RecentPlayedTrack = {
  key: string;
  title: string;
  artist: string;
  album?: string;
  image?: string;
  trackId: string;
  localTrackId?: string;
  onPolarr?: boolean;
};

function trackKey(title: string, artist: string) {
  return `track:${title.trim().toLowerCase()}::${artist.trim().toLowerCase()}`;
}

function isPlayedTrack(x: unknown): x is RecentPlayedTrack {
  if (!x || typeof x !== "object") return false;
  const row = x as RecentPlayedTrack;
  return (
    typeof row.key === "string" &&
    !row.key.startsWith("query:") &&
    typeof row.title === "string" &&
    typeof row.artist === "string" &&
    typeof row.trackId === "string" &&
    row.artist.trim().toLowerCase() !== "search"
  );
}

export function readRecentPlayedTracks(): RecentPlayedTrack[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPlayedTrack).slice(0, MAX);
  } catch {
    return [];
  }
}

export function pushRecentPlayedTrack(track: {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverPath?: string | null;
  quality?: string;
  localTrackId?: string;
  onPolarr?: boolean;
}) {
  if (typeof window === "undefined") return;
  const title = track.title.trim();
  const artist = track.artist.trim();
  if (!title || !artist || !track.id) return;

  const nextItem: RecentPlayedTrack = {
    key: trackKey(title, artist),
    title,
    artist,
    album: track.album?.trim() || undefined,
    image: track.coverPath || undefined,
    trackId: track.id,
    localTrackId: track.localTrackId,
    onPolarr:
      track.onPolarr ??
      (track.quality === "local" ||
        (!track.id.startsWith("stream:") &&
          !track.id.startsWith("live:") &&
          !track.id.startsWith("catalog:"))),
  };

  const prev = readRecentPlayedTracks().filter((x) => x.key !== nextItem.key);
  const next = [nextItem, ...prev].slice(0, MAX);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    emitRecentPlayedChanged();
  } catch {
    /* quota / private mode */
  }
}

export function removeRecentPlayedTrack(key: string) {
  if (typeof window === "undefined") return;
  const next = readRecentPlayedTracks().filter((x) => x.key !== key);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    emitRecentPlayedChanged();
  } catch {
    /* ignore */
  }
}

/** @deprecated Use readRecentPlayedTracks. */
export function readRecentSearchItems(): RecentPlayedTrack[] {
  return readRecentPlayedTracks();
}

/** @deprecated Use pushRecentPlayedTrack. */
export function pushRecentSearchItem(item: {
  kind?: string;
  key?: string;
  title: string;
  artist: string;
  album?: string;
  image?: string;
  trackId?: string;
  localTrackId?: string;
  onPolarr?: boolean;
}) {
  if (item.kind && item.kind !== "track") return;
  if (item.key?.startsWith("query:")) return;
  if (item.artist.trim().toLowerCase() === "search") return;
  pushRecentPlayedTrack({
    id: item.localTrackId || item.trackId || item.key || trackKey(item.title, item.artist),
    title: item.title,
    artist: item.artist,
    album: item.album,
    coverPath: item.image,
    localTrackId: item.localTrackId,
    onPolarr: item.onPolarr,
  });
}

/** @deprecated Use removeRecentPlayedTrack. */
export function removeRecentSearchItem(key: string) {
  removeRecentPlayedTrack(key);
}

/** @deprecated No-op — recents are played tracks only. */
export function pushRecentSearch(_term: string) {}

/** @deprecated Use readRecentPlayedTracks. */
export function readRecentSearches(): string[] {
  return [];
}

/** @deprecated Use readRecentPlayedTracks. */
export function filterRecentSearches(_prefix: string): string[] {
  return [];
}

/** @deprecated Use readRecentPlayedTracks. */
export function filterRecentSearchItems(prefix: string): RecentPlayedTrack[] {
  const q = prefix.trim().toLowerCase();
  const all = readRecentPlayedTracks();
  if (!q) return all;
  return all.filter(
    (x) =>
      x.title.toLowerCase().includes(q) ||
      x.artist.toLowerCase().includes(q) ||
      (x.album || "").toLowerCase().includes(q),
  );
}

export type RecentSearchItem = RecentPlayedTrack;
