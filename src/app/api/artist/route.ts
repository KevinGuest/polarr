import { json } from "@/lib/api";
import { buildArtistCatalog } from "@/lib/artist-catalog";
import {
  artistCoverKey,
  getArtistCoverMap,
  LidarrClient,
  resolveTrackCover,
  type LidarrAlbum,
} from "@/lib/lidarr";
import { formatTrackArtistLine } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const artist = (new URL(req.url).searchParams.get("name") || "").trim();
  if (!artist) return json({ error: "name required" }, { status: 400 });

  const key = artist.trim().toLowerCase();
  const client = LidarrClient.fromSettings();
  let lidarrAlbums: LidarrAlbum[] = [];
  let foreignArtistId: string | undefined;

  if (client) {
    const [albums, artists] = await Promise.all([
      client.listAlbums().catch(() => [] as LidarrAlbum[]),
      client.listArtists().catch(() => []),
    ]);
    const match = artists.find(
      (a) => (a.artistName || "").trim().toLowerCase() === key,
    );
    foreignArtistId = match?.foreignArtistId;
    const artistId = match?.id;
    lidarrAlbums = albums.filter((a) => {
      const name = (a.artist?.artistName || "").trim().toLowerCase();
      if (name === key) return true;
      return artistId != null && a.artistId === artistId;
    });
  }

  const artistCovers = await getArtistCoverMap();
  const artistImage =
    (foreignArtistId
      ? artistCovers.get(`mbid:${foreignArtistId}`)
      : null) ||
    artistCovers.get(artistCoverKey(artist)) ||
    null;

  const catalog = buildArtistCatalog(artist, {
    lidarrAlbums,
    artistImage,
  });

  const coverJobs: {
    id: string;
    coverPath: string | null;
    artist: string;
    album?: string;
  }[] = catalog.tracks.slice(0, 24).map((t) => ({
    id: t.id,
    coverPath: t.coverPath,
    artist: t.artist,
    album: t.album,
  }));

  for (const f of catalog.features) {
    if (f.kind === "album") continue;
    if (coverJobs.some((c) => c.id === f.trackId)) continue;
    coverJobs.push({
      id: f.trackId,
      coverPath: f.coverPath ?? null,
      artist: f.artist,
      album: f.album,
    });
  }

  const covers = await Promise.all(
    coverJobs.map(async (t) => ({
      id: t.id,
      coverUrl: await resolveTrackCover({
        coverPath: t.coverPath,
        artist: t.artist,
        album: t.album || "",
      }),
    })),
  );
  const coverById = new Map(covers.map((c) => [c.id, c.coverUrl]));

  const tiles = catalog.tiles.map((tile) => {
    if (tile.kind === "album") {
      const sample = catalog.tracks.find(
        (t) => (t.album || "").trim() === tile.album,
      );
      const img =
        (tile.image &&
        (/^https?:\/\//i.test(tile.image) || tile.image.startsWith("/api/"))
          ? tile.image
          : sample
            ? coverById.get(sample.id)
            : undefined) || tile.image;
      return { ...tile, image: img };
    }
    const img =
      (tile.image &&
      (/^https?:\/\//i.test(tile.image) || tile.image.startsWith("/api/"))
        ? tile.image
        : coverById.get(tile.trackId)) || tile.image;
    return { ...tile, image: img, coverPath: img };
  });

  return json({
    artist,
    image:
      (catalog.image &&
      (/^https?:\/\//i.test(catalog.image) ||
        catalog.image.startsWith("/api/"))
        ? catalog.image
        : coverById.get(catalog.tracks[0]?.id || "")) || catalog.image,
    albums: catalog.albums.map((tile) => {
      if (tile.kind !== "album") return tile;
      const match = tiles.find((t) => t.id === tile.id);
      return match || tile;
    }),
    singles: catalog.singles,
    features: catalog.features,
    tiles,
    tracks: catalog.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: formatTrackArtistLine(t.artist, t.title),
      primaryArtist: t.artist,
      album: t.album,
      duration: t.duration,
      coverPath: coverById.get(t.id) || t.coverPath,
      source: t.source,
    })),
  });
}
