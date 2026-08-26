import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  cleanAudioTag,
  isArtworkAudioPath,
  isArtworkFilename,
  readAudioTags,
} from "./audio-tags";
import {
  deleteTrack,
  getSettings,
  getTrackByPath,
  upsertTrack,
} from "./db";
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
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) {
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
  const album = parts.length >= 2 ? parts[parts.length - 2] : "Unknown Album";
  const artist =
    parts.length >= 3 ? parts[parts.length - 3] : "Unknown Artist";

  if (base.includes(" - ")) {
    const [a, ...rest] = base.split(" - ");
    const maybeArtist = a.trim();
    // "01 - Title" → track number, keep folder artist
    if (/^\d{1,3}$/.test(maybeArtist)) {
      return {
        artist,
        title: stripTrackNumber(rest.join(" - ").trim() || base),
        album,
      };
    }
    return {
      artist: maybeArtist || artist,
      title: stripTrackNumber(rest.join(" - ").trim() || base),
      album,
    };
  }
  return { title: stripTrackNumber(base), artist, album };
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

/**
 * Walk music + downloads roots, read embedded tags (ffprobe), and index
 * match_key so catalog/live resolve can find local files.
 */
export async function scanMusicLibrary(): Promise<{
  scanned: number;
  probed: number;
  added: number;
  root: string;
}> {
  const settings = getSettings();
  const root = settings.musicRoot || musicDir();
  // Always index downtify output so those files stream without extra setup.
  const dlRoot = path.resolve(downloadsDir());
  const roots = Array.from(new Set([path.resolve(root), dlRoot]));
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
    const unchanged =
      existing &&
      existing.fileSize === fileSize &&
      existing.mtimeMs === mtimeMs &&
      // Old path-only scans left duration 0 — re-probe once for real tags.
      existing.duration > 0 &&
      // Thumbnail stream tags used to overwrite titles as cover.jpg.
      !junkTitle;

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

  return { scanned: files.length, probed, added, root: roots.join(" + ") };
}
