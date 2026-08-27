/**
 * Resolve an on-disk audio path for playback.
 * Tries the stored path plus Umbrel/Lidarr mount aliases so library hits
 * don't fall through to YouTube when the DB path and container path differ.
 */
import fs from "node:fs";
import path from "node:path";
import { remapForeignMusicPath } from "./music-roots";
import { musicDir } from "./paths";

function isStreamPath(p: string): boolean {
  return (
    p.startsWith("stream:") ||
    p.startsWith("stream://") ||
    p.startsWith("live:") ||
    p.startsWith("live://")
  );
}

/**
 * Return an absolute path that exists as a non-empty file, or null.
 */
export function resolvePlayableAudioPath(
  rawPath: string | null | undefined,
): string | null {
  const raw = (rawPath || "").trim();
  if (!raw || isStreamPath(raw)) return null;

  const tries: string[] = [raw];
  try {
    tries.push(path.resolve(raw));
  } catch {
    /* ignore */
  }

  if (raw.startsWith("/music")) {
    tries.push(
      path.join(
        musicDir(),
        raw.slice("/music".length).replace(/^[\\/]+/, ""),
      ),
    );
  }

  // /music/Artist/... ↔ /downloads/media/music/Artist/...
  const remapped = remapForeignMusicPath(raw);
  if (remapped) tries.push(remapped);

  // Inverse: stored under /music but only /downloads/media/music is mounted
  if (raw.startsWith("/music/") || raw === "/music") {
    const rest = raw === "/music" ? "" : raw.slice("/music".length);
    tries.push(`/downloads/media/music${rest}`);
    tries.push(`/downloads/music${rest}`);
  }
  if (raw.startsWith("/downloads/media/music")) {
    tries.push(`/music${raw.slice("/downloads/media/music".length)}`);
  }
  if (raw.startsWith("/downloads/music/") || raw === "/downloads/music") {
    const rest =
      raw === "/downloads/music" ? "" : raw.slice("/downloads/music".length);
    tries.push(`/music${rest}`);
  }

  const seen = new Set<string>();
  for (const p of tries) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size > 0) return p;
    } catch {
      /* try next */
    }
  }
  return null;
}
