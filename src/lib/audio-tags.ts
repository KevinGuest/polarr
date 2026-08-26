/**
 * Read embedded audio tags via ffprobe (ships with ffmpeg in Docker).
 * Path/folder names are the fallback when tags are empty.
 */

import { spawn } from "node:child_process";

export type AudioTags = {
  title: string;
  artist: string;
  album: string;
  duration: number;
};

type FfprobeJson = {
  format?: {
    duration?: string;
    tags?: Record<string, string>;
  };
  streams?: Array<{
    codec_type?: string;
    disposition?: { attached_pic?: number };
    tags?: Record<string, string>;
  }>;
};

/**
 * Embedded cover streams / sidecar art often land as track titles
 * (e.g. cover.jpg, folder.png). Never treat these as songs.
 */
const ARTWORK_FILENAME =
  /^(cover|folder|front|back|albumart|album.?art|thumb|thumbnail|artwork|scan|booklet|r[-_]?cover|cd(art)?|disc)([-_ .]?\d*)\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;

export function isArtworkFilename(value: string | null | undefined): boolean {
  const t = String(value || "")
    .trim()
    .replace(/^.*[/\\]/, ""); // strip path prefixes
  if (!t) return false;
  return ARTWORK_FILENAME.test(t);
}

/** True when a file stem/basename is album art (cover.jpg.m4a, folder.jpg, …). */
export function isArtworkAudioPath(filePath: string | null | undefined): boolean {
  const p = String(filePath || "").trim();
  if (!p) return false;
  const base = p.replace(/^.*[/\\]/, "");
  const stem = base.replace(/\.[^.]+$/i, "");
  return isArtworkFilename(base) || isArtworkFilename(stem);
}

/** Drop cover-art filenames so callers fall back to path / job metadata. */
export function cleanAudioTag(value: string | null | undefined): string {
  const t = String(value || "").trim();
  if (!t || isArtworkFilename(t)) return "";
  return t;
}

function tagGet(
  tags: Record<string, string> | undefined,
  ...keys: string[]
): string {
  if (!tags) return "";
  const lower = new Map(
    Object.entries(tags).map(([k, v]) => [k.toLowerCase(), String(v || "").trim()]),
  );
  for (const key of keys) {
    const v = lower.get(key.toLowerCase());
    if (v) return v;
  }
  return "";
}

function mergeTags(...sources: Array<Record<string, string> | undefined>) {
  const out: Record<string, string> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (v && !out[k]) out[k] = v;
    }
  }
  return out;
}

export function readAudioTags(filePath: string): Promise<AudioTags | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      {
        stdio: ["ignore", "pipe", "ignore"],
        shell: false,
        windowsHide: true,
      },
    );

    let stdout = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve(null);
    }, 15_000);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 2_000_000) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        const data = JSON.parse(stdout) as FfprobeJson;
        // Attached pictures (yt-dlp --embed-thumbnail) often have
        // title=cover.jpg. Never merge those streams into track metadata.
        const audioStream = (data.streams || []).find(
          (s) =>
            s.codec_type === "audio" &&
            !s.disposition?.attached_pic,
        );
        const tags = mergeTags(data.format?.tags, audioStream?.tags);
        const title = cleanAudioTag(tagGet(tags, "title", "TITLE"));
        const artist = cleanAudioTag(
          tagGet(
            tags,
            "artist",
            "ARTIST",
            "album_artist",
            "ALBUM_ARTIST",
            "albumartist",
          ),
        );
        const album = cleanAudioTag(tagGet(tags, "album", "ALBUM"));
        const duration = Number(data.format?.duration) || 0;
        if (!title && !artist && !album && !duration) {
          resolve(null);
          return;
        }
        resolve({ title, artist, album, duration });
      } catch {
        resolve(null);
      }
    });
  });
}
