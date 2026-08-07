import { getSettings } from "./db";

export type LidarrArtist = {
  id?: number;
  artistName: string;
  foreignArtistId?: string;
  overview?: string;
  images?: { coverType: string; url: string; remoteUrl?: string }[];
  monitored?: boolean;
  path?: string;
  genres?: string[];
};

export type LidarrAlbum = {
  id?: number;
  title: string;
  foreignAlbumId?: string;
  artistId?: number;
  artist?: LidarrArtist;
  overview?: string;
  images?: { coverType: string; url: string; remoteUrl?: string }[];
  monitored?: boolean;
  releaseDate?: string;
  albumType?: string;
  secondaryTypes?: string[];
  statistics?: {
    trackFileCount?: number;
    totalTrackCount?: number;
    percentOfTracks?: number;
  };
};

export type LidarrTrack = {
  id?: number;
  albumId?: number;
  artistId?: number;
  title: string;
  trackNumber?: string;
  absoluteTrackNumber?: number;
  duration?: number;
  hasFile?: boolean;
  explicit?: boolean;
  mediumNumber?: number;
};

export type DiscoverRelease = {
  id: string;
  title: string;
  artist: string;
  year?: number;
  image?: string;
  foreignAlbumId?: string;
  foreignArtistId?: string;
  releaseDate?: string;
  monitored: boolean;
  /** Lidarr reports local files for this album */
  hasFile: boolean;
  lidarrAlbumId?: number;
};

export type LidarrLookupResult = {
  type: "artist" | "album";
  title: string;
  artist: string;
  overview?: string;
  image?: string;
  foreignId?: string;
  lidarrId?: number;
  alreadyInLibrary: boolean;
  raw: LidarrArtist | LidarrAlbum;
  /** Internal relevance 0–100 for query ranking */
  score?: number;
};

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

function absoluteHttpUrl(url?: string | null): string | undefined {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  return url;
}

/** Browser-safe URL for Lidarr-local MediaCover paths (artists often lack https remoteUrl). */
export function lidarrMediaCoverProxyUrl(mediaCoverPath: string): string | null {
  const path = mediaCoverPath.trim().split("?")[0];
  if (!path.startsWith("/MediaCover/")) return null;
  return `/api/lidarr/cover?src=${encodeURIComponent(path)}`;
}

export function coverFrom(
  images?: { coverType: string; url: string; remoteUrl?: string }[],
): string | undefined {
  if (!images?.length) return undefined;
  const preferred =
    images.find((i) => i.coverType === "poster") ||
    images.find((i) => i.coverType === "cover") ||
    images.find((i) => i.coverType === "fanart") ||
    images[0];
  // Prefer real https remotes. Library artist entries often set remoteUrl to a
  // filesystem-style /config/MediaCover/... path — ignore those and use url.
  const remote = absoluteHttpUrl(preferred?.remoteUrl);
  if (remote) return remote;
  const localHttp = absoluteHttpUrl(preferred?.url);
  if (localHttp) return localHttp;
  const rel =
    preferred?.url?.startsWith("/MediaCover/")
      ? preferred.url
      : preferred?.remoteUrl?.startsWith("/MediaCover/")
        ? preferred.remoteUrl
        : null;
  if (rel) {
    const proxy = lidarrMediaCoverProxyUrl(rel);
    if (proxy) return proxy;
  }
  return undefined;
}

export function albumCoverKey(artist: string, album: string): string {
  return `${artist.trim().toLowerCase()}::${album.trim().toLowerCase()}`;
}

export function artistCoverKey(artist: string): string {
  return artist.trim().toLowerCase();
}

let coverMapsCache: {
  at: number;
  albums: Map<string, string>;
  artists: Map<string, string>;
} | null = null;
const COVER_MAP_TTL_MS = 5 * 60_000;

async function loadCoverMaps(): Promise<{
  albums: Map<string, string>;
  artists: Map<string, string>;
}> {
  if (coverMapsCache && Date.now() - coverMapsCache.at < COVER_MAP_TTL_MS) {
    return coverMapsCache;
  }
  const client = LidarrClient.fromSettings();
  if (!client) {
    coverMapsCache = {
      at: Date.now(),
      albums: new Map(),
      artists: new Map(),
    };
    return coverMapsCache;
  }
  const [albums, artists] = await Promise.all([
    client.listAlbums().catch(() => [] as LidarrAlbum[]),
    client.listArtists().catch(() => [] as LidarrArtist[]),
  ]);
  const artistById = new Map<number, string>();
  const artistMap = new Map<string, string>();
  for (const a of artists) {
    if (a.id != null && a.artistName) artistById.set(a.id, a.artistName);
    const image = coverFrom(a.images);
    if (!image || !a.artistName?.trim()) continue;
    artistMap.set(artistCoverKey(a.artistName), image);
    if (a.foreignArtistId) {
      artistMap.set(`mbid:${a.foreignArtistId}`, image);
    }
  }
  const albumMap = new Map<string, string>();
  for (const a of albums) {
    const image = coverFrom(a.images);
    if (!image) continue;
    const artist =
      a.artist?.artistName ||
      (a.artistId != null ? artistById.get(a.artistId) : "") ||
      "";
    const title = a.title || "";
    if (!artist.trim() || !title.trim()) continue;
    albumMap.set(albumCoverKey(artist, title), image);
  }
  coverMapsCache = { at: Date.now(), albums: albumMap, artists: artistMap };
  return coverMapsCache;
}

/** artist+album → cover URL from Lidarr library (cached a few minutes). */
export async function getAlbumCoverMap(): Promise<Map<string, string>> {
  return (await loadCoverMaps()).albums;
}

/** artist name (or mbid:…) → portrait URL from Lidarr (cached a few minutes). */
export async function getArtistCoverMap(): Promise<Map<string, string>> {
  return (await loadCoverMaps()).artists;
}

/** Prefer stored cover, else Lidarr album art for artist+album. */
export async function resolveTrackCover(input: {
  coverPath?: string | null;
  artist: string;
  album: string;
}): Promise<string | null> {
  if (input.coverPath && /^https?:\/\//i.test(input.coverPath)) {
    return input.coverPath;
  }
  if (!input.artist.trim() || !input.album.trim()) return null;
  const map = await getAlbumCoverMap();
  return map.get(albumCoverKey(input.artist, input.album)) || null;
}

/** Case-insensitive relevance of a Lidarr hit to the user query. */
export function relevanceScore(
  query: string,
  title: string,
  artist: string,
): number {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return 0;
  const t = title.trim().toLowerCase();
  const a = artist.trim().toLowerCase();
  const hay = `${a} ${t}`.replace(/\s+/g, " ").trim();
  if (!t && !a) return 0;

  if (t === q || a === q || hay === q) return 100;
  if (`${a} - ${t}` === q || `${t} - ${a}` === q) return 98;

  if (t.startsWith(q) || a.startsWith(q) || hay.startsWith(q)) return 90;
  if (t.includes(q) || a.includes(q) || hay.includes(q)) return 82;

  const tokens = q.split(" ").filter((x) => x.length > 0);
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((tok) => t.includes(tok) || a.includes(tok));
  if (hits.length === 0) return 0;
  if (hits.length === tokens.length) return 70;
  // partial token match — only keep if majority of tokens hit
  const ratio = hits.length / tokens.length;
  if (ratio >= 0.6) return Math.round(45 + ratio * 20);
  return 0;
}

export class LidarrClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  static fromSettings() {
    const s = getSettings();
    if (!s.lidarrUrl || !s.lidarrApiKey) return null;
    return new LidarrClient(s.lidarrUrl, s.lidarrApiKey);
  }

  private async request<T>(
    path: string,
    init?: RequestInit & { query?: Record<string, string> },
  ): Promise<T> {
    const url = new URL(
      `${normalizeBase(this.baseUrl)}/api/v1${path.startsWith("/") ? path : `/${path}`}`,
    );
    if (init?.query) {
      for (const [k, v] of Object.entries(init.query)) {
        url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url, {
      ...init,
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Lidarr ${res.status}: ${body || res.statusText}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async status() {
    return this.request<{ version?: string; instanceName?: string }>(
      "/system/status",
    );
  }

  async rootFolders() {
    return this.request<{ id: number; path: string }[]>("/rootfolder");
  }

  async qualityProfiles() {
    return this.request<{ id: number; name: string }[]>("/qualityprofile");
  }

  async metadataProfiles() {
    return this.request<{ id: number; name: string }[]>("/metadataprofile");
  }

  async searchArtists(term: string): Promise<LidarrArtist[]> {
    return this.request<LidarrArtist[]>("/artist/lookup", {
      query: { term },
    });
  }

  async searchAlbums(term: string): Promise<LidarrAlbum[]> {
    return this.request<LidarrAlbum[]>("/album/lookup", {
      query: { term },
    });
  }

  async listArtists(): Promise<LidarrArtist[]> {
    return this.request<LidarrArtist[]>("/artist");
  }

  async listAlbums(): Promise<LidarrAlbum[]> {
    return this.request<LidarrAlbum[]>("/album");
  }

  async getAlbum(id: number): Promise<LidarrAlbum> {
    return this.request<LidarrAlbum>(`/album/${id}`);
  }

  async getAlbumByForeignId(foreignAlbumId: string): Promise<LidarrAlbum[]> {
    return this.request<LidarrAlbum[]>("/album", {
      query: { foreignAlbumId },
    });
  }

  /** Tracklist for an album already in Lidarr (by numeric album id). */
  async getAlbumTracks(albumId: number): Promise<LidarrTrack[]> {
    return this.request<LidarrTrack[]>("/track", {
      query: { albumId: String(albumId) },
    });
  }

  /** Albums in a date window (Lidarr calendar). */
  async calendar(startIso: string, endIso: string): Promise<LidarrAlbum[]> {
    return this.request<LidarrAlbum[]>("/calendar", {
      query: {
        start: startIso,
        end: endIso,
        includeArtist: "true",
        unmonitored: "false",
      },
    });
  }

  async wantedMissing(pageSize = 24): Promise<LidarrAlbum[]> {
    const data = await this.request<{ records?: LidarrAlbum[] } | LidarrAlbum[]>(
      "/wanted/missing",
      {
        query: {
          page: "1",
          pageSize: String(pageSize),
          sortKey: "releaseDate",
          sortDirection: "descending",
        },
      },
    );
    if (Array.isArray(data)) return data;
    return data.records || [];
  }

  private toDiscover(a: LidarrAlbum): DiscoverRelease {
    const hasFile = (a.statistics?.trackFileCount || 0) > 0;
    const year = a.releaseDate
      ? Number(a.releaseDate.slice(0, 4)) || undefined
      : undefined;
    return {
      id: String(a.id ?? a.foreignAlbumId ?? `${a.title}-${a.artist?.artistName}`),
      title: a.title,
      artist: a.artist?.artistName || "Unknown Artist",
      year,
      image: coverFrom(a.images),
      foreignAlbumId: a.foreignAlbumId,
      foreignArtistId: a.artist?.foreignArtistId,
      releaseDate: a.releaseDate,
      monitored: Boolean(a.monitored),
      hasFile,
      lidarrAlbumId: a.id,
    };
  }

  /**
   * Recent + upcoming albums from Lidarr (calendar + missing + library).
   * Default window: last 12 months + ~1 month upcoming ("anything new").
   */
  async latestReleases(
    limit = 24,
    monthsBack = 12,
  ): Promise<DiscoverRelease[]> {
    const now = new Date();
    const start = new Date(now);
    start.setMonth(start.getMonth() - monthsBack);
    const end = new Date(now);
    end.setMonth(end.getMonth() + 1);

    const startIso = start.toISOString().slice(0, 10);
    const endIso = end.toISOString().slice(0, 10);
    const maxAgeMs = (monthsBack + 1) * 31 * 24 * 60 * 60 * 1000;

    const [cal, missing, all] = await Promise.all([
      this.calendar(startIso, endIso).catch(() => [] as LidarrAlbum[]),
      this.wantedMissing(Math.max(limit * 2, 48)).catch(() => [] as LidarrAlbum[]),
      this.listAlbums().catch(() => [] as LidarrAlbum[]),
    ]);

    const inWindow = (releaseDate?: string) => {
      if (!releaseDate) return false;
      const day = releaseDate.slice(0, 10);
      if (day < startIso || day > endIso) return false;
      const released = Date.parse(day);
      if (!Number.isFinite(released)) return false;
      if (now.getTime() - released > maxAgeMs) return false;
      return true;
    };

    const recentFromAll = [...all].filter((a) => inWindow(a.releaseDate));

    const merged = new Map<string, DiscoverRelease>();
    for (const a of [...cal, ...missing, ...recentFromAll]) {
      if (!inWindow(a.releaseDate)) continue;
      const card = this.toDiscover(a);
      const key = card.foreignAlbumId || card.id;
      if (!merged.has(key)) merged.set(key, card);
    }

    return [...merged.values()]
      .filter((r) => Boolean(r.image))
      .sort((a, b) =>
        (b.releaseDate || "").localeCompare(a.releaseDate || ""),
      )
      .slice(0, limit);
  }

  /** Browseable Lidarr library albums (not limited to last 6 months). */
  async catalogLibrary(limit = 48): Promise<DiscoverRelease[]> {
    const all = await this.listAlbums().catch(() => [] as LidarrAlbum[]);
    const artists = await this.listArtists().catch(() => [] as LidarrArtist[]);
    const nameById = new Map<number, string>();
    for (const a of artists) {
      if (a.id != null && a.artistName) nameById.set(a.id, a.artistName);
    }
    return [...all]
      .map((a) => {
        const card = this.toDiscover(a);
        if (
          (!card.artist || card.artist === "Unknown Artist") &&
          a.artistId != null
        ) {
          card.artist = nameById.get(a.artistId) || card.artist;
        }
        return card;
      })
      .filter((r) => Boolean(r.image) && r.title)
      .sort((a, b) =>
        (b.releaseDate || "").localeCompare(a.releaseDate || "") ||
        a.title.localeCompare(b.title),
      )
      .slice(0, limit);
  }

  /** Artist faces for home browse. */
  async catalogArtists(limit = 24): Promise<
    { name: string; image?: string; foreignArtistId?: string }[]
  > {
    const artists = await this.listArtists().catch(() => [] as LidarrArtist[]);
    return artists
      .map((a) => ({
        name: (a.artistName || "").trim(),
        image: coverFrom(a.images),
        foreignArtistId: a.foreignArtistId,
      }))
      .filter((a) => a.name)
      .slice(0, limit);
  }

  async addArtist(payload: Record<string, unknown>) {
    return this.request<LidarrArtist>("/artist", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async searchCommands(name: string, body: Record<string, unknown> = {}) {
    return this.request("/command", {
      method: "POST",
      body: JSON.stringify({ name, ...body }),
    });
  }

  async lookup(term: string): Promise<LidarrLookupResult[]> {
    const q = term.trim();
    if (!q) return [];

    const [artists, albums] = await Promise.all([
      this.searchArtists(q).catch(() => [] as LidarrArtist[]),
      this.searchAlbums(q).catch(() => [] as LidarrAlbum[]),
    ]);

    const results: LidarrLookupResult[] = [];

    for (const a of albums) {
      const image = coverFrom(a.images);
      // Albums without cover art are noise for discovery UI — skip them.
      if (!image) continue;
      const artist = a.artist?.artistName || "Unknown Artist";
      const title = a.title || "";
      const score = relevanceScore(q, title, artist);
      if (score < 45) continue;
      results.push({
        type: "album",
        title,
        artist,
        overview: a.overview,
        image,
        foreignId: a.foreignAlbumId,
        lidarrId: a.id,
        alreadyInLibrary: typeof a.id === "number" && a.id > 0,
        raw: a,
        score,
      });
    }

    for (const a of artists) {
      const image = coverFrom(a.images);
      if (!image) continue;
      const name = a.artistName || "";
      const score = relevanceScore(q, name, name);
      if (score < 45) continue;
      results.push({
        type: "artist",
        title: name,
        artist: name,
        overview: a.overview,
        image,
        foreignId: a.foreignArtistId,
        lidarrId: a.id,
        alreadyInLibrary: typeof a.id === "number" && a.id > 0,
        raw: a,
        score,
      });
    }

    // Prefer albums, then higher relevance
    return results
      .sort((x, y) => {
        const typeRank = (t: string) => (t === "album" ? 0 : 1);
        if (typeRank(x.type) !== typeRank(y.type)) {
          return typeRank(x.type) - typeRank(y.type);
        }
        return (y.score || 0) - (x.score || 0);
      })
      .slice(0, 24);
  }

  async requestArtist(foreignArtistId: string, artistName: string) {
    const existing = await this.listArtists();
    const found = existing.find((a) => a.foreignArtistId === foreignArtistId);
    if (found) {
      await this.searchCommands("ArtistSearch", { artistId: found.id });
      return found;
    }

    const [roots, qualities, metadata] = await Promise.all([
      this.rootFolders(),
      this.qualityProfiles(),
      this.metadataProfiles(),
    ]);
    if (!roots[0] || !qualities[0] || !metadata[0]) {
      throw new Error(
        "Lidarr is missing a root folder, quality profile, or metadata profile",
      );
    }

    const lookup = await this.searchArtists(artistName);
    const match =
      lookup.find((a) => a.foreignArtistId === foreignArtistId) || lookup[0];
    if (!match) throw new Error("Artist not found in Lidarr lookup");

    const created = await this.addArtist({
      ...match,
      monitored: true,
      rootFolderPath: roots[0].path,
      qualityProfileId: qualities[0].id,
      metadataProfileId: metadata[0].id,
      addOptions: {
        searchForMissingAlbums: true,
      },
    });
    return created;
  }
}

export async function probeLidarr(url: string, apiKey: string) {
  const client = new LidarrClient(url, apiKey);
  const status = await client.status();
  return status;
}
