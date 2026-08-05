import path from "node:path";
import fs from "node:fs";

export function dataDir(): string {
  const dir = process.env.POLARR_DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function musicDir(): string {
  const dir = process.env.POLARR_MUSIC_DIR || path.join(process.cwd(), "music");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function downloadsDir(): string {
  const dir =
    process.env.POLARR_DOWNLOADS_DIR || path.join(musicDir(), "downloads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return path.join(dataDir(), "polarr.db");
}
