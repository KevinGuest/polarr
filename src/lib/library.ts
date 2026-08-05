import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getSettings, upsertTrack } from "./db";
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
    return {
      artist: a.trim() || artist,
      title: rest.join(" - ").trim() || base,
      album,
    };
  }
  return { title: base, artist, album };
}

export function scanMusicLibrary(): { scanned: number; root: string } {
  const settings = getSettings();
  const root = settings.musicRoot || musicDir();
  // Always index downtify output so those files stream without extra setup.
  const dlRoot = path.resolve(downloadsDir());
  const roots = Array.from(
    new Set([path.resolve(root), dlRoot]),
  );
  const files = roots.flatMap((dir) => walk(dir));
  for (const file of files) {
    const tags = parseTagsFromPath(file);
    let fileSize = 0;
    let mtimeMs = 0;
    try {
      const st = fs.statSync(file);
      fileSize = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      // skip stat failure; still index path
    }
    const abs = path.resolve(file);
    const underDownload =
      abs === dlRoot || abs.startsWith(dlRoot + path.sep);
    upsertTrack({
      id: randomBytes(12).toString("hex"),
      title: tags.title,
      artist: tags.artist,
      album: tags.album,
      duration: 0,
      path: file,
      coverPath: null,
      source: underDownload ? "fallback" : "library",
      externalId: null,
      fileSize,
      mtimeMs,
    });
  }
  return { scanned: files.length, root: roots.join(" + ") };
}
