import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { isArtworkFilename, readAudioTags } from "./audio-tags";
import { getSettings, getTrackByPath, upsertTrack } from "./db";
import { downloadsDir, musicDir } from "./paths";

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
  root: string;
}> {
  const settings = getSettings();
  const root = settings.musicRoot || musicDir();
  // Always index downtify output so those files stream without extra setup.
  const dlRoot = path.resolve(downloadsDir());
  const roots = Array.from(new Set([path.resolve(root), dlRoot]));
  const files = roots.flatMap((dir) => walk(dir));
  let probed = 0;

  await mapPool(files, PROBE_CONCURRENCY, async (file) => {
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

    const abs = path.resolve(file);
    const underDownload =
      abs === dlRoot || abs.startsWith(dlRoot + path.sep);

    upsertTrack({
      id: existing?.id || randomBytes(12).toString("hex"),
      title,
      artist,
      album,
      duration,
      path: file,
      coverPath: existing?.coverPath ?? null,
      source: underDownload ? "fallback" : "library",
      externalId: existing?.externalId ?? null,
      fileSize,
      mtimeMs,
    });
  });

  return { scanned: files.length, probed, root: roots.join(" + ") };
}
