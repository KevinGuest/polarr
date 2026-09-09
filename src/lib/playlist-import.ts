/**
 * Parse playlist exports (Spotify/Exportify CSV, Apple CSV, plain text)
 * and resolve tracks into Polarr library / stream stubs.
 */

import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  addTrackToPlaylist,
  createPlaylist,
  ensureHistoryTrack,
  findTrack,
  getPlaylistCoverPath,
  searchTracksLocal,
  setPlaylistCoverPath,
  type TrackRow,
} from "@/lib/db";
import { playlistCoversDir } from "@/lib/paths";
import {
  namesMatch,
  normalizeArtistName,
  normalizeTitle,
  primaryArtistName,
  scoreTrackMatch,
  titlesMatch,
  TRACK_MATCH_MIN_SCORE,
} from "@/lib/track-match";
import { searchCatalog } from "@/lib/catalog-search";

export const PLAYLIST_IMPORT_MAX = 500;

export type ImportTrackRow = {
  title: string;
  artist: string;
  album?: string;
};

export type ImportResult = {
  playlistId: string;
  name: string;
  matched: number;
  unresolved: number;
  total: number;
  unresolvedSample: { title: string; artist: string }[];
  coverImported?: boolean;
};

const COVER_MAX_BYTES = 5 * 1024 * 1024;
const COVER_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

function isAllowedCoverHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  return (
    h === "i.scdn.co" ||
    h === "mosaic.scdn.co" ||
    h.endsWith(".scdn.co") ||
    h.endsWith(".spotifycdn.com") ||
    h.endsWith(".dzcdn.net") ||
    h === "e-cdns-images.dzcdn.net" ||
    h === "cdn-images.dzcdn.net" ||
    h === "i.ytimg.com" ||
    h === "yt3.ggpht.com" ||
    h.endsWith(".ggpht.com") ||
    h.endsWith(".googleusercontent.com")
  );
}

/** Download a remote playlist cover into playlist-covers/ (best-effort). */
export async function importPlaylistCoverFromUrl(
  userId: string,
  playlistId: string,
  coverUrl: string | null | undefined,
): Promise<boolean> {
  const raw = (coverUrl || "").trim();
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!isAllowedCoverHost(parsed.hostname)) return false;

  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "Polarr/1.0",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > COVER_MAX_BYTES) return false;

    const headerType = (res.headers.get("content-type") || "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    let ext = headerType ? COVER_TYPES.get(headerType) : undefined;
    if (!ext) {
      const pathExt = path.extname(parsed.pathname).toLowerCase().replace(".", "");
      if (pathExt === "jpeg") ext = "jpg";
      else if (["jpg", "png", "webp", "gif"].includes(pathExt)) ext = pathExt;
    }
    if (!ext) {
      // Spotify CDN often omits content-type / extension — sniff magic bytes.
      if (buf[0] === 0xff && buf[1] === 0xd8) ext = "jpg";
      else if (buf[0] === 0x89 && buf[1] === 0x50) ext = "png";
      else if (buf[0] === 0x47 && buf[1] === 0x49) ext = "gif";
      else if (
        buf.length >= 12 &&
        buf.toString("ascii", 0, 4) === "RIFF" &&
        buf.toString("ascii", 8, 12) === "WEBP"
      ) {
        ext = "webp";
      } else {
        ext = "jpg";
      }
    }

    const dir = playlistCoversDir();
    await mkdir(dir, { recursive: true });
    const filename = `${playlistId}.${ext}`;
    const abs = path.join(dir, filename);
    await writeFile(abs, buf);

    const previous = getPlaylistCoverPath(userId, playlistId);
    if (previous && previous !== abs) {
      await unlink(previous).catch(() => null);
    }
    return Boolean(setPlaylistCoverPath(userId, playlistId, filename));
  } catch {
    return false;
  }
}

/** Minimal CSV line split respecting double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function headerIndex(headers: string[], ...aliases: string[]): number {
  const norm = headers.map((h) =>
    h
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, " "),
  );
  for (const alias of aliases) {
    const i = norm.indexOf(alias.toLowerCase());
    if (i >= 0) return i;
  }
  // Partial contains
  for (const alias of aliases) {
    const a = alias.toLowerCase();
    const i = norm.findIndex((h) => h === a || h.includes(a));
    if (i >= 0) return i;
  }
  return -1;
}

function parseCsvPlaylist(text: string): ImportTrackRow[] | null {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  const headers = splitCsvLine(lines[0]);
  const titleIdx = headerIndex(
    headers,
    "track name",
    "track title",
    "song",
    "song title",
    "title",
    "name",
  );
  const artistIdx = headerIndex(
    headers,
    "artist name",
    "artist",
    "artists",
    "album artist",
  );
  if (titleIdx < 0 || artistIdx < 0) return null;

  const albumIdx = headerIndex(headers, "album name", "album", "album title");
  const rows: ImportTrackRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const title = (cols[titleIdx] || "").trim();
    const artist = (cols[artistIdx] || "").trim();
    if (!title || !artist) continue;
    const album =
      albumIdx >= 0 ? (cols[albumIdx] || "").trim() || undefined : undefined;
    rows.push({ title, artist, album });
  }
  return rows.length > 0 ? rows : null;
}

function parsePlainLines(text: string): ImportTrackRow[] {
  const rows: ImportTrackRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    // Strip leading track numbers: "01. " / "1 - " / "1)"
    line = line.replace(/^\d+[\).:\-]\s*/, "").trim();
    if (!line || line.startsWith("#")) continue;

    // "Artist - Title" or "Title - Artist" (prefer Artist - Title)
    const parts = line.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) {
      const left = parts[0].trim();
      const right = parts.slice(1).join(" - ").trim();
      if (left && right) {
        rows.push({ artist: left, title: right });
        continue;
      }
    }

    // "Artist: Title"
    const colon = line.indexOf(":");
    if (colon > 0 && colon < line.length - 1) {
      const left = line.slice(0, colon).trim();
      const right = line.slice(colon + 1).trim();
      if (left && right) {
        rows.push({ artist: left, title: right });
      }
    }
  }
  return rows;
}

/** Parse CSV or plain text into track rows (capped). */
export function parsePlaylistText(text: string): ImportTrackRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const csv = parseCsvPlaylist(trimmed);
  const rows = csv && csv.length > 0 ? csv : parsePlainLines(trimmed);

  const seen = new Set<string>();
  const out: ImportTrackRow[] = [];
  for (const r of rows) {
    const title = r.title.trim();
    const artist = primaryArtistName(r.artist).trim() || r.artist.trim();
    if (!title || !artist) continue;
    const key = `${normalizeArtistName(artist)}|${normalizeTitle(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      artist,
      album: r.album?.trim() || undefined,
    });
    if (out.length >= PLAYLIST_IMPORT_MAX) break;
  }
  return out;
}

function matchLocal(row: ImportTrackRow): TrackRow | null {
  // findTrack already does exact + soft local match
  const hit = findTrack(row.artist, row.title);
  if (hit) return hit;

  // Extra pass for odd catalog spellings searchTracksLocal may still surface
  const q = `${row.artist} ${row.title}`.trim();
  const hits = [
    ...searchTracksLocal(q, 12),
    ...searchTracksLocal(row.title, 12),
  ];
  let best: TrackRow | null = null;
  let bestScore = 0;
  for (const h of hits) {
    const s = scoreTrackMatch(h, row.artist, row.title);
    if (s > bestScore) {
      bestScore = s;
      best = h;
    }
  }
  return best && bestScore >= TRACK_MATCH_MIN_SCORE ? best : null;
}

async function matchCatalog(row: ImportTrackRow): Promise<TrackRow | null> {
  const q = `"${row.title}" ${row.artist}`;
  const { tracks } = await searchCatalog(q, 8).catch(() => ({
    tracks: [] as Awaited<ReturnType<typeof searchCatalog>>["tracks"],
  }));

  let best = tracks.find(
    (t) =>
      titlesMatch(t.title, row.title) && namesMatch(t.artist, row.artist),
  );
  if (!best) {
    best = tracks.find((t) => titlesMatch(t.title, row.title));
  }
  if (!best) return null;

  return ensureHistoryTrack({
    title: best.title,
    artist: best.artist,
    album: best.album || row.album,
    coverPath: best.image || null,
  });
}

async function resolveRow(row: ImportTrackRow): Promise<TrackRow | null> {
  const local = matchLocal(row);
  if (local) return local;
  return matchCatalog(row);
}

/** Create a playlist from already-parsed track rows. */
export async function importPlaylistFromRows(
  userId: string,
  name: string,
  rows: ImportTrackRow[],
  opts?: { coverUrl?: string | null },
): Promise<ImportResult | { error: string }> {
  if (rows.length === 0) {
    return { error: "No tracks found in that playlist." };
  }

  const capped = rows.slice(0, PLAYLIST_IMPORT_MAX);
  const playlist = createPlaylist(
    userId,
    name.trim() || "Imported playlist",
  );

  let matched = 0;
  const unresolved: { title: string; artist: string }[] = [];

  const CONCURRENCY = 4;
  for (let i = 0; i < capped.length; i += CONCURRENCY) {
    const batch = capped.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(batch.map((r) => resolveRow(r)));
    for (let j = 0; j < batch.length; j++) {
      const track = resolved[j];
      const row = batch[j];
      if (!track) {
        unresolved.push({ title: row.title, artist: row.artist });
        continue;
      }
      const added = addTrackToPlaylist(userId, playlist.id, track.id);
      if (added.ok) matched++;
      else unresolved.push({ title: row.title, artist: row.artist });
    }
  }

  const coverImported = await importPlaylistCoverFromUrl(
    userId,
    playlist.id,
    opts?.coverUrl,
  );

  return {
    playlistId: playlist.id,
    name: playlist.name,
    matched,
    unresolved: unresolved.length,
    total: capped.length,
    unresolvedSample: unresolved.slice(0, 12),
    coverImported,
  };
}

/** Create a playlist from pasted/uploaded export text. */
export async function importPlaylistForUser(
  userId: string,
  name: string,
  text: string,
): Promise<ImportResult | { error: string }> {
  const rows = parsePlaylistText(text);
  if (rows.length === 0) {
    return {
      error:
        "No tracks found. Use an Exportify/Spotify CSV or lines like Artist - Title.",
    };
  }
  return importPlaylistFromRows(userId, name, rows);
}
