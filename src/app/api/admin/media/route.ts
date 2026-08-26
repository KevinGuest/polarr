import fs from "node:fs";
import { getAdminUser, json } from "@/lib/api";
import {
  countAlbums,
  countTracks,
  listAlbumsPaginated,
  listTracks,
  listTracksForAlbum,
  type TrackRow,
} from "@/lib/db";
import { coverFromMap, getAlbumCoverMap } from "@/lib/lidarr";
import { scanMusicLibrary } from "@/lib/library";
import {
  ADMIN_SOURCE_LABELS,
  localSourceBadge,
} from "@/lib/track-source-badge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 10;

function fileAvailable(filePath: string | null | undefined): boolean {
  const p = (filePath || "").trim();
  if (!p || p.startsWith("stream:") || p.startsWith("stream://")) return false;
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function mapTrackDto(t: TrackRow, covers?: Map<string, string>) {
  const available = fileAvailable(t.path);
  const sourceKind = localSourceBadge(t.source);
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    source: t.source,
    sourceLabel: ADMIN_SOURCE_LABELS[sourceKind],
    sourceKind,
    path: t.path,
    coverPath:
      (covers
        ? coverFromMap(covers, t.artist, t.album, t.title, t.coverPath)
        : t.coverPath) || null,
    addedAt: t.addedAt,
    available,
  };
}

/**
 * Admin media browser — paginated tracks / albums with on-disk availability.
 * GET ?mode=tracks|albums&page=1
 * GET ?mode=album&artist=&album=  — album tracklist + presence
 * POST { action: "scan" } — scan library (also used from Requests)
 */
export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") || "tracks").toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("limit")) || PAGE_SIZE),
  );
  const offset = (page - 1) * limit;

  if (mode === "album") {
    const artist = (url.searchParams.get("artist") || "").trim();
    const album = (url.searchParams.get("album") || "").trim();
    if (!artist || !album) {
      return json({ error: "artist and album required" }, { status: 400 });
    }
    const covers = await getAlbumCoverMap();
    const tracks = listTracksForAlbum(artist, album, 500).map((t) =>
      mapTrackDto(t, covers),
    );
    const present = tracks.filter((t) => t.available).length;
    return json({
      album: {
        artist,
        title: album,
        trackCount: tracks.length,
        presentCount: present,
        complete: tracks.length > 0 && present === tracks.length,
        coverPath: tracks.find((t) => t.coverPath)?.coverPath ?? null,
      },
      tracks,
    });
  }

  if (mode === "albums") {
    const total = countAlbums();
    const covers = await getAlbumCoverMap();
    const albums = listAlbumsPaginated(limit, offset).map((a) => {
      const tracks = listTracksForAlbum(a.artist, a.title, 500);
      const present = tracks.filter((t) => fileAvailable(t.path)).length;
      return {
        artist: a.artist,
        title: a.title,
        trackCount: a.trackCount,
        presentCount: present,
        complete: a.trackCount > 0 && present === a.trackCount,
        coverPath:
          coverFromMap(covers, a.artist, a.title, "", a.coverPath) ||
          a.coverPath,
        addedAt: a.addedAt,
      };
    });
    return json({
      albums,
      page,
      limit,
      total,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    });
  }

  // tracks
  const total = countTracks();
  const covers = await getAlbumCoverMap();
  const tracks = listTracks(limit, offset).map((t) => mapTrackDto(t, covers));
  return json({
    tracks,
    page,
    limit,
    total,
    pageCount: Math.max(1, Math.ceil(total / limit)),
  });
}

export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });

  let body: { action?: string } = {};
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    body = {};
  }

  if (body.action === "scan" || !body.action) {
    const result = await scanMusicLibrary();
    return json({
      ok: true,
      ...result,
      totalTracks: countTracks(),
    });
  }

  return json({ error: "Unknown action" }, { status: 400 });
}
