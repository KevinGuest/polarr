/**
 * Client-side library metadata cache (Spotify-style).
 * IndexedDB persistence + in-memory search for instant typeahead.
 */

import type { CatalogTrackHit } from "@/lib/catalog-search";
import { scoreSearchHit, tokenizeSearchQuery } from "@/lib/track-match";
import { LIBRARY_CHANGED_EVENT } from "@/lib/ui-events";

export type CachedLibraryTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverPath: string | null;
  source: string;
  updatedAt: string;
  addedAt?: string;
};

type MetaState = {
  cursor: string | null;
  syncedAt: number;
  total: number;
};

const DB_NAME = "polarr-library-meta";
const DB_VERSION = 1;
const TRACK_STORE = "tracks";
const META_STORE = "meta";
const META_KEY = "sync";

let dbPromise: Promise<IDBDatabase> | null = null;
let memory = new Map<string, CachedLibraryTrack>();
let memoryReady = false;
let syncing: Promise<void> | null = null;
let started = false;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("indexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRACK_STORE)) {
        db.createObjectStore(TRACK_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error || new Error("library meta db failed"));
  });
  return dbPromise;
}

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("library meta request failed"));
  });
}

async function loadMemoryFromIdb() {
  if (memoryReady) return;
  try {
    const db = await openDb();
    const rows = await idbReq(
      db.transaction(TRACK_STORE, "readonly").objectStore(TRACK_STORE).getAll(),
    );
    memory = new Map(
      (rows as CachedLibraryTrack[]).map((t) => [t.id, t] as const),
    );
  } catch {
    memory = new Map();
  }
  memoryReady = true;
}

async function readMeta(): Promise<MetaState> {
  try {
    const db = await openDb();
    const row = await idbReq(
      db
        .transaction(META_STORE, "readonly")
        .objectStore(META_STORE)
        .get(META_KEY) as IDBRequest<{ key: string } & MetaState | undefined>,
    );
    if (row) {
      return {
        cursor: row.cursor ?? null,
        syncedAt: row.syncedAt || 0,
        total: row.total || 0,
      };
    }
  } catch {
    /* ignore */
  }
  return { cursor: null, syncedAt: 0, total: 0 };
}

async function writeMeta(meta: MetaState) {
  const db = await openDb();
  await idbReq(
    db
      .transaction(META_STORE, "readwrite")
      .objectStore(META_STORE)
      .put({ key: META_KEY, ...meta }),
  );
}

async function putTracks(tracks: CachedLibraryTrack[]) {
  if (!tracks.length) return;
  const db = await openDb();
  const tx = db.transaction(TRACK_STORE, "readwrite");
  const store = tx.objectStore(TRACK_STORE);
  for (const t of tracks) {
    store.put(t);
    memory.set(t.id, t);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("putTracks failed"));
  });
}

async function removeTracks(ids: string[]) {
  if (!ids.length) return;
  const db = await openDb();
  const tx = db.transaction(TRACK_STORE, "readwrite");
  const store = tx.objectStore(TRACK_STORE);
  for (const id of ids) {
    store.delete(id);
    memory.delete(id);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("removeTracks failed"));
  });
}

async function clearAllTracks() {
  const db = await openDb();
  await idbReq(db.transaction(TRACK_STORE, "readwrite").objectStore(TRACK_STORE).clear());
  memory = new Map();
  memoryReady = true;
}

type SyncPage = {
  version: string;
  complete: boolean;
  nextSince: string | null;
  total: number;
  tracks: CachedLibraryTrack[];
  deletedIds: string[];
};

async function fetchSyncPage(since: string | null): Promise<SyncPage | null> {
  const params = new URLSearchParams({ limit: "2000" });
  if (since) params.set("since", since);
  const res = await fetch(`/api/library/sync?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as SyncPage;
}

/** Pull deltas (or full snapshot) into IndexedDB + memory. */
export async function syncLibraryMeta(opts?: { forceFull?: boolean }) {
  if (typeof window === "undefined") return;
  if (syncing) return syncing;
  syncing = (async () => {
    await loadMemoryFromIdb();
    let meta = await readMeta();
    let since = opts?.forceFull ? null : meta.cursor;
    if (opts?.forceFull) {
      await clearAllTracks();
      meta = { cursor: null, syncedAt: 0, total: 0 };
    }

    let guard = 0;
    for (;;) {
      if (guard++ > 200) break;
      const page = await fetchSyncPage(since);
      if (!page) break;

      await putTracks(
        (page.tracks || []).map((t) => ({
          id: String(t.id),
          title: String(t.title || ""),
          artist: String(t.artist || ""),
          album: String(t.album || ""),
          duration: Number(t.duration) || 0,
          coverPath: t.coverPath || null,
          source: String(t.source || "library"),
          updatedAt: String(t.updatedAt || ""),
          addedAt: t.addedAt ? String(t.addedAt) : undefined,
        })),
      );
      if (page.deletedIds?.length) {
        await removeTracks(page.deletedIds.map(String));
      }

      const nextCursor = page.complete
        ? page.version || since
        : page.nextSince || page.version || since;
      meta = {
        cursor: nextCursor || null,
        syncedAt: Date.now(),
        total: page.total || memory.size,
      };
      await writeMeta(meta);

      if (page.complete) break;
      since = page.nextSince || page.version;
      if (!since) break;
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

export function searchCachedLibraryTracks(
  query: string,
  limit = 48,
): CatalogTrackHit[] {
  if (!memoryReady || memory.size === 0) return [];
  const term = query.trim().replace(/\s+/g, " ");
  if (!term) return [];
  const tokens = tokenizeSearchQuery(term);
  if (!tokens.length) return [];

  const hits: { track: CachedLibraryTrack; score: number }[] = [];
  for (const track of memory.values()) {
    const hay = `${track.title} ${track.artist} ${track.album}`.toLowerCase();
    if (!tokens.every((tok) => hay.includes(tok.toLowerCase()))) continue;
    const score = scoreSearchHit(term, {
      title: track.title,
      artist: track.artist,
      album: track.album,
    });
    hits.push({ track, score });
  }

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ track }) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      image: track.coverPath || undefined,
      duration: track.duration || undefined,
      localTrackId: track.id,
      onPolarr: true,
      localSource: track.source === "fallback" ? "polarr" : "lidarr",
    }));
}

export function cachedLibraryTrackCount(): number {
  return memory.size;
}

export function isLibraryMetaReady(): boolean {
  return memoryReady && memory.size > 0;
}

/**
 * Start background sync: initial pull, periodic refresh, library-changed.
 * Safe to call once from AuthProvider.
 */
export function startLibraryMetaSync(): () => void {
  if (typeof window === "undefined") return () => {};
  if (started) {
    void syncLibraryMeta();
    return () => {};
  }
  started = true;

  void loadMemoryFromIdb().then(() => syncLibraryMeta());

  const onLibrary = () => {
    void syncLibraryMeta();
  };
  window.addEventListener(LIBRARY_CHANGED_EVENT, onLibrary);

  const onOnline = () => {
    void syncLibraryMeta();
  };
  window.addEventListener("online", onOnline);

  const interval = window.setInterval(
    () => {
      void syncLibraryMeta();
    },
    60_000,
  );

  return () => {
    started = false;
    window.removeEventListener(LIBRARY_CHANGED_EVENT, onLibrary);
    window.removeEventListener("online", onOnline);
    window.clearInterval(interval);
  };
}
