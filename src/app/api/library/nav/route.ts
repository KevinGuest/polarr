import { json, getAuthUser } from "@/lib/api";
import {
  countLikedTracks,
  libraryAlbumPinKey,
  libraryFolderPinKey,
  libraryPlaylistPinKey,
  listLibraryPins,
  listPinnedAlbumNavItems,
  listPlaylistFolders,
  listUserPlaylistsInFolder,
  topArtistsFromUserLibrary,
} from "@/lib/db";
import {
  albumCoverKey,
  artistCoverKey,
  getAlbumCoverMap,
  getArtistCoverMap,
} from "@/lib/lidarr";
import { albumHref } from "@/lib/album-ref";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const covers = await getAlbumCoverMap();
  const artistCovers = await getArtistCoverMap();
  const pins = listLibraryPins(user.id);
  const pinOrder = new Map(pins.map((p, i) => [p.itemKey, i]));

  const albums = listPinnedAlbumNavItems(user.id).map((item) => {
    const fromDb =
      item.image && /^https?:\/\//i.test(item.image) ? item.image : null;
    const fromLidarr =
      covers.get(albumCoverKey(item.artist, item.title)) || null;
    const pinKey = libraryAlbumPinKey(item.artist, item.title);
    return {
      type: "album" as const,
      key: item.key,
      title: item.title,
      artist: item.artist,
      tracks: item.tracks,
      image: fromDb || fromLidarr,
      pinKey,
      pinned: true,
      href: albumHref({ title: item.title, artist: item.artist }),
      updatedAt: 0,
    };
  });

  const playlists = listUserPlaylistsInFolder(user.id, null).map((p) => {
    const pinKey = libraryPlaylistPinKey(p.id);
    return {
      type: "playlist" as const,
      key: `playlist:${p.id}`,
      title: p.name,
      artist: "You",
      tracks: p.trackCount,
      image: p.coverUrl,
      pinKey,
      pinned: pinOrder.has(pinKey),
      href: `/playlist/${encodeURIComponent(p.id)}`,
      updatedAt: Date.parse(p.updatedAt) || 0,
    };
  });

  const folders = listPlaylistFolders(user.id).map((f) => {
    const pinKey = libraryFolderPinKey(f.id);
    return {
      type: "folder" as const,
      key: `folder:${f.id}`,
      title: f.name,
      artist: "You",
      tracks: f.playlistCount,
      image: null as string | null,
      pinKey,
      pinned: pinOrder.has(pinKey),
      href: `/folder/${encodeURIComponent(f.id)}`,
      updatedAt: Date.parse(f.updatedAt) || 0,
    };
  });

  let items = [...folders, ...playlists, ...albums];

  items = items.slice().sort((a, b) => {
    const ai = pinOrder.has(a.pinKey) ? pinOrder.get(a.pinKey)! : 9999;
    const bi = pinOrder.has(b.pinKey) ? pinOrder.get(b.pinKey)! : 9999;
    if (ai !== bi) return ai - bi;
    if (a.type !== "album" && b.type === "album") return -1;
    if (a.type === "album" && b.type !== "album") return 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  // Artists the user actually has in their library — not the full Lidarr scan.
  const libraryArtists = topArtistsFromUserLibrary(user.id, 200).map((row) => {
    const name = row.artist;
    const qs = new URLSearchParams({ name });
    const image = artistCovers.get(artistCoverKey(name)) || null;
    return {
      type: "artist" as const,
      key: `artist:${name.trim().toLowerCase()}`,
      title: name,
      artist: "Artist",
      tracks: row.tracks,
      image,
      pinKey: "",
      pinned: false,
      href: `/artist?${qs.toString()}`,
      updatedAt: row.tracks,
    };
  });

  return json({
    liked: {
      title: "Liked Songs",
      tracks: countLikedTracks(user.id),
      pinKey: "liked",
      pinned: pinOrder.has("liked"),
    },
    items,
    // Only user-saved albums (same as album rows in items) — never the full scan.
    albums,
    artists: libraryArtists,
    pins: pins.map((p) => p.itemKey),
  });
}
