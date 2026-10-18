import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  cleanAudioTag,
  displayTitleFromStem,
  isArtworkAudioPath,
  isArtworkFilename,
  looksLikeFilenameTitle,
  readAudioTags,
} from "./audio-tags";
import {
  deleteTrack,
  deleteTracks,
  getSettings,
  getTrackByPath,
  listLibraryTrackIdPaths,
  upsertTrack,
} from "./db";
import { remapForeignMusicPath } from "./music-roots";
import { downloadsDir, musicDir } from "./paths";
import { classifyIndexedTrackSource } from "./track-source";

const AUDIO_EXT = new Set([
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".wav",
  ".wma",
]);

/** How many ffprobe workers at once. */
const PROBE_CONCURRENCY = 4;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Never follow symlinks — shared Umbrel Downloads mounts can plant
    // evil.mp3 → /immich/... links that would otherwise be indexed+streamed.
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (
      entry.isFile() &&
      AUDIO_EXT.has(path.extname(entry.name).toLowerCase())
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Drop leading track/disc numbers: "01 - Song", "01. Song", "01 Song". */
function stripTrackNumber(name: string): string {
  const cleaned = name.replace(/^\d{1,3}(\s*[-.]\s*|\s+)/, "").trim();
  return cleaned || name;
}

function parseTagsFromPath(filePath: string): {
  title: string;
  artist: string;
  album: string;
} {
  const parts = filePath.split(path.sep).filter(Boolean);
  const file = parts[parts.length - 1] || "Unknown";
  const base = path.basename(file, path.extname(file));
  const albumRaw = parts.length >= 2 ? parts[parts.length - 2] : "Unknown Album";
  const artist =
    parts.length >= 3 ? parts[parts.length - 3] : "Unknown Artist";
  const album = looksLikeFilenameTitle(albumRaw)
    ? displayTitleFromStem(albumRaw) || albumRaw
    : albumRaw;

  if (base.includes(" - ")) {
    const [a, ...rest] = base.split(" - ");
    const maybeArtist = a.trim();
    // "01 - Title" → track number, keep folder artist
    if (/^\d{1,3}$/.test(maybeArtist)) {
      return {
        artist,
        title: displayTitleFromStem(
          stripTrackNumber(rest.join(" - ").trim() || base),
          artist,
        ),
        album,
      };
    }
    return {
      artist: maybeArtist || artist,
      title: displayTitleFromStem(
        stripTrackNumber(rest.join(" - ").trim() || base),
        maybeArtist || artist,
      ),
      album,
    };
  }

  return {
    title: displayTitleFromStem(stripTrackNumber(base), artist),
    artist,
    album,
  };
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  const n = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]!);
      }
    }),
  );
}

function dirIsScannable(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return false;
    fs.readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

function pathUnderRoot(filePath: string, root: string): boolean {
  const abs = path.resolve(filePath);
  const rootAbs = path.resolve(root);
  return abs === rootAbs || abs.startsWith(rootAbs + path.sep);
}

/** Prefer parent folders so /music and /music/downloads are walked once. */
function collapseNestedRoots(dirs: string[]): string[] {
  const resolved = [...new Set(dirs.map((dir) => path.resolve(dir)))].sort(
    (a, b) => a.length - b.length,
  );
  const out: string[] = [];
  for (const dir of resolved) {
    if (out.some((parent) => pathUnderRoot(dir, parent))) continue;
    out.push(dir);
  }
  return out;
}

/** True when this DB path lives in a tree we actually listed this scan. */
function storedPathUnderWalkedRoots(
  stored: string,
  walkedRoots: string[],
): boolean {
  if (walkedRoots.some((root) => pathUnderRoot(stored, root))) return true;
  const remapped = remapForeignMusicPath(stored);
  return Boolean(
    remapped && walkedRoots.some((root) => pathUnderRoot(remapped, root)),
  );
}

/**
 * Drop library rows whose files vanished (Lidarr delete, manual rm).
 * Skips prune when no music root can be listed, so an unmounted volume
 * cannot wipe the index.
 */
function pruneMissingLibraryTracks(files: string[], roots: string[]): number {
  const walkedRoots = roots.filter(dirIsScannable);
  if (walkedRoots.length === 0) {
    console.warn(
      "[polarr] library scan skipped prune — music root is missing or unreadable",
    );
    return 0;
  }

  const seen = new Set(files.map((file) => path.resolve(file)));
  const staleIds: string[] = [];
  for (const row of listLibraryTrackIdPaths()) {
    const abs = path.resolve(row.path);
    if (seen.has(abs)) continue;
    const remapped = remapForeignMusicPath(row.path);
    if (remapped && seen.has(path.resolve(remapped))) continue;
    if (!storedPathUnderWalkedRoots(row.path, walkedRoots)) continue;
    staleIds.push(row.id);
  }

  if (!staleIds.length) return 0;
  const removed = deleteTracks(staleIds);
  console.info(`[polarr] library scan pruned ${removed} missing tracks`);
  return removed;
}

/**
 * Walk music + downloads roots, read embedded tags (ffprobe), and index
 * match_key so catalog/live resolve can find local files. Rows whose files
 * are gone from those roots are removed so libraryCount matches disk.
 */
export async function scanMusicLibrary(): Promise<{
  scanned: number;
  probed: number;
  added: number;
  removed: number;
  root: string;
}> {
  const settings = getSettings();
  const root = settings.musicRoot || musicDir();
  // Always index downtify output so those files stream without extra setup.
  const dlRoot = path.resolve(downloadsDir());
  const aliasRoots = [
    remapForeignMusicPath(root),
    dirIsScannable("/music") ? "/music" : null,
  ].filter((dir): dir is string => Boolean(dir && dirIsScannable(dir)));
  const roots = collapseNestedRoots([root, dlRoot, ...aliasRoots]);
  const files = roots.flatMap((dir) => walk(dir));
  let probed = 0;
  let added = 0;

  await mapPool(files, PROBE_CONCURRENCY, async (file) => {
    // Sidecar art sometimes gets an audio extension (cover.jpg.m4a) — never index.
    if (isArtworkAudioPath(file)) {
      const junk = getTrackByPath(file);
      if (junk) deleteTrack(junk.id);
      return;
    }

    let fileSize = 0;
    let mtimeMs = 0;
    try {
      const st = fs.statSync(file);
      fileSize = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      // skip stat failure; still index path
    }

    const existing = getTrackByPath(file);
    const junkTitle = isArtworkFilename(existing?.title);
    const slugTitle = looksLikeFilenameTitle(existing?.title);
    const unchanged =
      existing &&
      existing.fileSize === fileSize &&
      existing.mtimeMs === mtimeMs &&
      // Old path-only scans left duration 0 — re-probe once for real tags.
      existing.duration > 0 &&
      // Thumbnail stream tags used to overwrite titles as cover.jpg.
      !junkTitle &&
      // Download-filename titles need a one-shot humanize pass.
      !slugTitle;

    const pathTags = parseTagsFromPath(file);
    let title = unchanged ? existing.title : pathTags.title;
    let artist = unchanged ? existing.artist : pathTags.artist;
    let album = unchanged ? existing.album : pathTags.album;
    let duration = unchanged ? existing.duration : 0;

    if (!unchanged) {
      const embedded = await readAudioTags(file);
      probed += 1;
      if (embedded) {
        title = embedded.title || title;
        artist = embedded.artist || artist;
        album = embedded.album || album;
        duration = embedded.duration || duration;
      }
    }

    title = cleanAudioTag(title) || pathTags.title;
    artist = cleanAudioTag(artist) || pathTags.artist;
    album = cleanAudioTag(album) || pathTags.album;

    // Embedded tags sometimes store the raw download filename — humanize it.
    if (looksLikeFilenameTitle(title)) {
      title = displayTitleFromStem(title, artist) || pathTags.title || title;
    }
    if (looksLikeFilenameTitle(album)) {
      album = displayTitleFromStem(album) || pathTags.album || album;
    }

    // Final guard: never write artwork filenames into the catalog.
    if (isArtworkFilename(title) || isArtworkAudioPath(file)) {
      if (existing) deleteTrack(existing.id);
      return;
    }

    const isNew = !existing;
    upsertTrack({
      id: existing?.id || randomBytes(12).toString("hex"),
      title,
      artist,
      album,
      duration,
      path: file,
      coverPath: existing?.coverPath ?? null,
      source: classifyIndexedTrackSource(file),
      externalId: existing?.externalId ?? null,
      fileSize,
      mtimeMs,
    });
    if (isNew) added += 1;
  });

  const removed = pruneMissingLibraryTracks(files, roots);

  if (added > 0) {
    try {
      const { notifyDiscord } = await import("@/lib/admin-notify");
      notifyDiscord("trackAdded", {
        title: added === 1 ? "Track added" : "Tracks added",
        description:
          added === 1
            ? "1 new track indexed into the library."
            : `${added} new tracks indexed into the library.`,
        fields: [
          { name: "New", value: String(added), inline: true },
          { name: "Scanned", value: String(files.length), inline: true },
        ],
        href: "/library",
      });
    } catch {
      /* ignore */
    }
  }

  // Kick the AAC sidecar pre-encoder so new FLAC/WAV drops play instantly.
  try {
    const { warmLibrarySidecars } = await import("@/lib/stream-compat");
    const { listLibraryTrackPaths } = await import("@/lib/db");
    const { queued, removed: sidecarOrphans } = warmLibrarySidecars(
      listLibraryTrackPaths(),
    );
    if (queued || sidecarOrphans) {
      console.info(
        `[polarr] sidecar pre-encode · ${queued} queued · ${sidecarOrphans} orphans removed`,
      );
    }
  } catch {
    /* non-fatal */
  }

  return {
    scanned: files.length,
    probed,
    added,
    removed,
    root: roots.join(" + "),
  };
}
