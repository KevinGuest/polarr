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
  statistics?: {
    trackFileCount?: number;
    totalTrackCount?: number;
    percentOfTracks?: number;
  };
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
};

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

function coverFrom(
  images?: { coverType: string; url: string; remoteUrl?: string }[],
): string | undefined {
  if (!images?.length) return undefined;
  const preferred =
    images.find((i) => i.coverType === "poster") ||
    images.find((i) => i.coverType === "cover") ||
    images[0];
  return preferred.remoteUrl || preferred.url;
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
   * Recent + upcoming albums from Lidarr (calendar + missing).
   * hasFile=false → request/download target; hasFile=true may already be streamable after scan.
   */
  async latestReleases(limit = 24): Promise<DiscoverRelease[]> {
    const now = new Date();
    const start = new Date(now);
    start.setMonth(start.getMonth() - 3);
    const end = new Date(now);
    end.setMonth(end.getMonth() + 1);

    const startIso = start.toISOString().slice(0, 10);
    const endIso = end.toISOString().slice(0, 10);

    const [cal, missing, all] = await Promise.all([
      this.calendar(startIso, endIso).catch(() => [] as LidarrAlbum[]),
      this.wantedMissing(limit).catch(() => [] as LidarrAlbum[]),
      this.listAlbums().catch(() => [] as LidarrAlbum[]),
    ]);

    const recentFromAll = [...all]
      .filter((a) => a.releaseDate)
      .sort((a, b) =>
        (b.releaseDate || "").localeCompare(a.releaseDate || ""),
      )
      .slice(0, limit);

    const merged = new Map<string, DiscoverRelease>();
    for (const a of [...cal, ...missing, ...recentFromAll]) {
      const card = this.toDiscover(a);
      const key = card.foreignAlbumId || card.id;
      if (!merged.has(key)) merged.set(key, card);
    }

    return [...merged.values()]
      .sort((a, b) =>
        (b.releaseDate || "").localeCompare(a.releaseDate || ""),
      )
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
    const [artists, albums] = await Promise.all([
      this.searchArtists(term).catch(() => [] as LidarrArtist[]),
      this.searchAlbums(term).catch(() => [] as LidarrAlbum[]),
    ]);

    const artistResults: LidarrLookupResult[] = artists.slice(0, 12).map((a) => ({
      type: "artist",
      title: a.artistName,
      artist: a.artistName,
      overview: a.overview,
      image: coverFrom(a.images),
      foreignId: a.foreignArtistId,
      lidarrId: a.id,
      alreadyInLibrary: Boolean(a.id),
      raw: a,
    }));

    const albumResults: LidarrLookupResult[] = albums.slice(0, 20).map((a) => ({
      type: "album",
      title: a.title,
      artist: a.artist?.artistName || "Unknown Artist",
      overview: a.overview,
      image: coverFrom(a.images),
      foreignId: a.foreignAlbumId,
      lidarrId: a.id,
      alreadyInLibrary: Boolean(a.id),
      raw: a,
    }));

    return [...albumResults, ...artistResults];
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
