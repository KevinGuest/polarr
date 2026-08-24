/**
 * Catalog search independent of Lidarr.
 * Tracks: Deezer + iTunes (+ MusicBrainz fallback) so a song query always
 * has somewhere to hit. Albums/artists: Deezer + iTunes.
 */

import { namesMatch, normalizeArtistName } from "@/lib/artist-portrait";
import { scoreSearchHit } from "@/lib/track-match";

export type CatalogTrackHit = {
  id: string;
  title: string;
  artist: string;
  album: string;
  image?: string;
  duration?: number;
  /** Library file id when this song is already on the server. */
  localTrackId?: string;
  /** Indexed on this Polarr server (Lidarr or download). */
  onPolarr?: boolean;
};

export type CatalogAlbumHit = {
  id: string;
  title: string;
  artist: string;
  image?: string;
  year?: number;
  foreignAlbumId?: string;
  lidarrAlbumId?: number;
  alreadyInLibrary?: boolean;
};

export type CatalogArtistHit = {
  id: string;
  name: string;
  image?: string;
  foreignArtistId?: string;
  alreadyInLibrary?: boolean;
};

type DeezerTrack = {
  id?: number;
  title?: string;
  duration?: number;
  album?: {
    title?: string;
    cover_medium?: string;
    cover_big?: string;
  };
  artist?: { name?: string };
};

type DeezerAlbum = {
  id?: number;
  title?: string;
  cover_medium?: string;
  cover_big?: string;
  release_date?: string;
  artist?: { name?: string };
};

type DeezerArtist = {
  id?: number;
  name?: string;
  nb_fan?: number;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
};

type ItunesResult = {
  wrapperType?: string;
  kind?: string;
  trackName?: string;
  trackId?: number;
  collectionName?: string;
  collectionId?: number;
  artistName?: string;
  artistId?: number;
  artworkUrl100?: string;
  artworkUrl60?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
};

type MbRecording = {
  id?: string;
  title?: string;
  length?: number | null;
  "artist-credit"?: {
    name?: string;
    joinphrase?: string;
    artist?: { name?: string };
  }[];
  releases?: { title?: string; id?: string }[];
};

const UA = "Polarr/1.0 (https://github.com/KevinGuest/polarr)";

function trackKey(artist: string, title: string) {
  return `${artist.trim().toLowerCase()}::${title.trim().toLowerCase()}`;
}

function itunesArt(url?: string): string | undefined {
  if (!url) return undefined;
  // Bump 100px artwork to a usable size
  return url.replace(/100x100bb/i, "600x600bb");
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": UA,
        ...(init?.headers || {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function searchDeezerTracks(q: string, limit: number) {
  const enc = encodeURIComponent(q);
  const body = await fetchJson<{ data?: DeezerTrack[] }>(
    `https://api.deezer.com/search/track?q=${enc}&limit=${limit}`,
  );
  const out: CatalogTrackHit[] = [];
  for (const t of body?.data || []) {
    const title = (t.title || "").trim();
    const artist = (t.artist?.name || "").trim();
    if (!title || !artist) continue;
    out.push({
      id: `deezer:track:${t.id ?? trackKey(artist, title)}`,
      title,
      artist,
      album: (t.album?.title || title).trim(),
      image: t.album?.cover_big || t.album?.cover_medium,
      duration: typeof t.duration === "number" ? t.duration : undefined,
    });
  }
  return out;
}

/** Build title-focused query variants so “Love me drake” finds Love Me (feat. Drake). */
function trackQueryVariants(q: string): string[] {
  const term = q.trim().replace(/\s+/g, " ");
  if (!term) return [];
  const variants = new Set<string>([term]);
  const tokens = term.split(" ").filter(Boolean);
  if (tokens.length >= 2) {
    // Last token as artist hint, rest as title
    const title = tokens.slice(0, -1).join(" ");
    const artist = tokens[tokens.length - 1]!;
    variants.add(title);
    variants.add(`${title} ${artist}`);
    // Deezer advanced search — pulls title matches even when artist is a feature
    variants.add(`track:"${title}" ${artist}`);
    variants.add(`track:"${title}"`);
    if (tokens.length >= 3) {
      const title2 = tokens.slice(0, -2).join(" ");
      const artist2 = tokens.slice(-2).join(" ");
      variants.add(`track:"${title2}" ${artist2}`);
    }
  }
  return [...variants];
}

async function searchDeezerTracksMulti(q: string, limit: number) {
  const variants = trackQueryVariants(q).slice(0, 4);
  const lists = await Promise.all(
    variants.map((v) =>
      searchDeezerTracks(v, Math.min(limit, 20)).catch(
        () => [] as CatalogTrackHit[],
      ),
    ),
  );
  return lists.flat();
}

async function searchItunesTracks(q: string, limit: number) {
  const enc = encodeURIComponent(q);
  const body = await fetchJson<{ results?: ItunesResult[] }>(
    `https://itunes.apple.com/search?term=${enc}&media=music&entity=song&limit=${limit}`,
  );
  const out: CatalogTrackHit[] = [];
  for (const r of body?.results || []) {
    if (r.wrapperType && r.wrapperType !== "track") continue;
    if (r.kind && r.kind !== "song") continue;
    const title = (r.trackName || "").trim();
    // Keep feat. credits in artist line — needed for “Love Me … Drake”
    const artist = (r.artistName || "").trim();
    if (!title || !artist) continue;
    out.push({
      id: `itunes:track:${r.trackId ?? trackKey(artist, title)}`,
      title,
      artist,
      album: (r.collectionName || title).trim(),
      image: itunesArt(r.artworkUrl100 || r.artworkUrl60),
      duration: r.trackTimeMillis
        ? Math.round(r.trackTimeMillis / 1000)
        : undefined,
    });
  }
  return out;
}

async function searchItunesTracksMulti(q: string, limit: number) {
  const term = q.trim().replace(/\s+/g, " ");
  const tokens = term.split(" ").filter(Boolean);
  const variants = new Set<string>([term]);
  if (tokens.length >= 2) {
    variants.add(tokens.slice(0, -1).join(" "));
  }
  const lists = await Promise.all(
    [...variants].slice(0, 3).map((v) =>
      searchItunesTracks(v, Math.min(limit, 25)).catch(
        () => [] as CatalogTrackHit[],
      ),
    ),
  );
  return lists.flat();
}

async function searchMbTracks(q: string, limit: number) {
  // Lucene query — prefer recording title when query looks like a song name
  const enc = encodeURIComponent(q);
  const body = await fetchJson<{ recordings?: MbRecording[] }>(
    `https://musicbrainz.org/ws/2/recording?query=${enc}&limit=${limit}&fmt=json`,
  );
  const out: CatalogTrackHit[] = [];
  for (const r of body?.recordings || []) {
    const title = (r.title || "").trim();
    const credit = (r["artist-credit"] || [])
      .map((c) => `${c.name || c.artist?.name || ""}${c.joinphrase || ""}`)
      .join("")
      .trim();
    if (!title || !credit) continue;
    const album = (r.releases?.[0]?.title || "").trim() || title;
    out.push({
      id: `mb:recording:${r.id ?? trackKey(credit, title)}`,
      title,
      artist: credit,
      album,
      duration: r.length ? Math.round(r.length / 1000) : undefined,
    });
  }
  return out;
}

async function searchDeezerAlbums(q: string, limit: number) {
  const enc = encodeURIComponent(q);
  const body = await fetchJson<{ data?: DeezerAlbum[] }>(
    `https://api.deezer.com/search/album?q=${enc}&limit=${limit}`,
  );
  const out: CatalogAlbumHit[] = [];
  for (const a of body?.data || []) {
    const title = (a.title || "").trim();
    const artist = (a.artist?.name || "").trim();
    if (!title || !artist) continue;
    const date = (a.release_date || "").slice(0, 10);
    out.push({
      id: `deezer:album:${a.id ?? trackKey(artist, title)}`,
      title,
      artist,
      image: a.cover_big || a.cover_medium,
      year: date ? Number(date.slice(0, 4)) || undefined : undefined,
    });
  }
  return out;
}

async function searchItunesAlbums(q: string, limit: number) {
  const enc = encodeURIComponent(q);
  const body = await fetchJson<{ results?: ItunesResult[] }>(
    `https://itunes.apple.com/search?term=${enc}&media=music&entity=album&limit=${limit}`,
  );
  const out: CatalogAlbumHit[] = [];
  for (const r of body?.results || []) {
    if (r.wrapperType && r.wrapperType !== "collection") continue;
    const title = (r.collectionName || "").trim();
    const artist = (r.artistName || "").trim();
    if (!title || !artist) continue;
    const date = (r.releaseDate || "").slice(0, 10);
    out.push({
      id: `itunes:album:${r.collectionId ?? trackKey(artist, title)}`,
      title,
      artist,
      image: itunesArt(r.artworkUrl100 || r.artworkUrl60),
      year: date ? Number(date.slice(0, 4)) || undefined : undefined,
    });
  }
  return out;
}

async function searchDeezerArtists(q: string, limit: number) {
  const enc = encodeURIComponent(q);
  const body = await fetchJson<{ data?: DeezerArtist[] }>(
    `https://api.deezer.com/search/artist?q=${enc}&limit=${Math.max(limit, 20)}`,
  );
  const qNorm = normalizeArtistName(q);
  const byName = new Map<
    string,
    CatalogArtistHit & { fans: number; exact: boolean }
  >();
  for (const a of body?.data || []) {
    const name = (a.name || "").trim();
    if (!name) continue;
    const key = normalizeArtistName(name);
    if (!key) continue;
    const fans = Number(a.nb_fan) || 0;
    const exact = namesMatch(name, q);
    const prev = byName.get(key);
    // Same name → keep highest fans (skip tiny fan-account duplicates)
    if (prev && prev.fans >= fans) continue;
    byName.set(key, {
      id: `deezer:artist:${a.id ?? key}`,
      name,
      image: a.picture_xl || a.picture_big || a.picture_medium,
      fans,
      exact,
    });
  }
  return [...byName.values()]
    .sort((a, b) => {
      // Exact query match first, then fans
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      if (qNorm && a.name && b.name) {
        const aStarts = normalizeArtistName(a.name).startsWith(qNorm);
        const bStarts = normalizeArtistName(b.name).startsWith(qNorm);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
      }
      return b.fans - a.fans;
    })
    .slice(0, limit)
    .map(({ fans: _f, exact: _e, ...hit }) => hit);
}

async function searchItunesArtists(q: string, limit: number) {
  const enc = encodeURIComponent(q);
  const body = await fetchJson<{ results?: ItunesResult[] }>(
    `https://itunes.apple.com/search?term=${enc}&media=music&entity=musicArtist&limit=${limit}`,
  );
  const out: CatalogArtistHit[] = [];
  for (const r of body?.results || []) {
    const name = (r.artistName || "").trim();
    if (!name) continue;
    out.push({
      id: `itunes:artist:${r.artistId ?? name.toLowerCase()}`,
      name,
      image: itunesArt(r.artworkUrl100 || r.artworkUrl60),
    });
  }
  return out;
}

function mergeTracks(
  lists: CatalogTrackHit[][],
  limit: number,
  query?: string,
): CatalogTrackHit[] {
  const byKey = new Map<string, CatalogTrackHit>();
  for (const list of lists) {
    for (const t of list) {
      const key = trackKey(t.artist, t.title);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, t);
        continue;
      }
      // Prefer richer metadata (feat. credits, cover)
      const prefer =
        (t.image && !prev.image) ||
        (t.artist.length > prev.artist.length &&
          /feat\.|ft\.|&/i.test(t.artist));
      if (prefer) byKey.set(key, { ...prev, ...t, image: t.image || prev.image });
    }
  }
  const out = [...byKey.values()];
  if (query?.trim()) {
    out.sort(
      (a, b) => scoreSearchHit(query, b) - scoreSearchHit(query, a),
    );
  }
  return out.slice(0, limit);
}

/**
 * Title-first ranking so “Love me drake” beats popular Drake songs that
 * don’t match the title. Artist/feat tokens still help break ties.
 */
export function scoreTrackHit(query: string, hit: CatalogTrackHit): number {
  return scoreSearchHit(query, hit);
}

function mergeAlbums(
  lists: CatalogAlbumHit[][],
  limit: number,
  query?: string,
): CatalogAlbumHit[] {
  const byKey = new Map<string, CatalogAlbumHit>();
  for (const list of lists) {
    for (const a of list) {
      const key = trackKey(a.artist, a.title);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, a);
        continue;
      }
      if (a.image && !prev.image) byKey.set(key, { ...prev, image: a.image });
    }
  }
  const out = [...byKey.values()];
  if (query?.trim()) {
    out.sort((a, b) => {
      const sa = scoreTrackHit(query, {
        id: a.id,
        title: a.title,
        artist: a.artist,
        album: a.title,
        image: a.image,
      });
      const sb = scoreTrackHit(query, {
        id: b.id,
        title: b.title,
        artist: b.artist,
        album: b.title,
        image: b.image,
      });
      return sb - sa;
    });
  }
  return out.slice(0, limit);
}

function mergeArtists(
  lists: CatalogArtistHit[][],
  limit: number,
): CatalogArtistHit[] {
  const byKey = new Map<string, CatalogArtistHit>();
  for (const list of lists) {
    for (const a of list) {
      const key = a.name.trim().toLowerCase();
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, a);
        continue;
      }
      if (a.image && !prev.image) {
        byKey.set(key, { ...prev, image: a.image });
      }
    }
  }
  // Prefer artists that already have photos
  return [...byKey.values()]
    .sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)))
    .slice(0, limit);
}

/** Search tracks / albums / artists without Lidarr. */
export async function searchCatalog(q: string, limit = 24): Promise<{
  tracks: CatalogTrackHit[];
  albums: CatalogAlbumHit[];
  artists: CatalogArtistHit[];
}> {
  const term = q.trim();
  if (!term) return { tracks: [], albums: [], artists: [] };

  const n = Math.min(40, Math.max(12, limit));

  const [
    deezerTracks,
    itunesTracks,
    deezerAlbums,
    itunesAlbums,
    deezerArtists,
    itunesArtists,
  ] = await Promise.all([
    searchDeezerTracksMulti(term, n).catch(() => [] as CatalogTrackHit[]),
    searchItunesTracksMulti(term, n).catch(() => [] as CatalogTrackHit[]),
    searchDeezerAlbums(term, n).catch(() => [] as CatalogAlbumHit[]),
    searchItunesAlbums(term, n).catch(() => [] as CatalogAlbumHit[]),
    searchDeezerArtists(term, n).catch(() => [] as CatalogArtistHit[]),
    searchItunesArtists(term, n).catch(() => [] as CatalogArtistHit[]),
  ]);

  let tracks = mergeTracks([deezerTracks, itunesTracks], limit, term);

  // MusicBrainz only if both commercial APIs miss — slower / rate-limited
  if (tracks.length === 0) {
    const mb = await searchMbTracks(term, n).catch(
      () => [] as CatalogTrackHit[],
    );
    tracks = mergeTracks([mb], limit, term);
  }

  return {
    tracks,
    albums: mergeAlbums([deezerAlbums, itunesAlbums], limit, term),
    artists: mergeArtists([deezerArtists, itunesArtists], limit),
  };
}
