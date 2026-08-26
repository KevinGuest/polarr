import path from "node:path";
import { getSettings, type TrackRow } from "./db";
import { dataDir, downloadsDir, musicDir } from "./paths";

/**
 * Classify an indexed audio file.
 *
 * On Umbrel, Lidarr's library lives at host `/downloads/media/music` → container
 * `/music`, often with `POLARR_DOWNLOADS_DIR=/music` (same as music root). Those
 * files are Lidarr library — not Polarr fallback downloads.
 *
 * Polarr fallback (downtify) uses a distinct folder: `{data}/downloads` or
 * `{music}/downloads` when that subfolder is separate from the music root.
 */
export function classifyIndexedTrackSource(filePath: string): TrackRow["source"] {
  const abs = path.resolve(filePath);
  const musicRoot = path.resolve(getSettings().musicRoot || musicDir());
  const dlRoot = path.resolve(downloadsDir());
  const dataDownloads = path.resolve(dataDir(), "downloads");

  if (abs === dataDownloads || abs.startsWith(dataDownloads + path.sep)) {
    return "fallback";
  }

  if (
    dlRoot !== musicRoot &&
    (abs === dlRoot || abs.startsWith(dlRoot + path.sep))
  ) {
    return "fallback";
  }

  if (getSettings().lidarrUrl?.trim()) return "lidarr";
  return "library";
}
