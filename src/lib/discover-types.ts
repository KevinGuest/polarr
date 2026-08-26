/** Shared discover JSON shape (safe for client + server). */

export type DiscoverReleaseCard = {
  id: string;
  title: string;
  artist: string;
  year?: number;
  image?: string;
  foreignAlbumId?: string;
  releaseDate?: string;
  hasFile: boolean;
  monitored: boolean;
  lidarrAlbumId?: number;
  rank?: number;
};

export type DiscoverArtistCard = {
  name: string;
  image?: string;
  foreignArtistId?: string;
};

export type DiscoverMoreFromItem =
  | {
      kind: "album";
      id: string;
      title: string;
      subtitle: string;
      artist: string;
      album: string;
      image?: string | null;
      trackCount: number;
      foreignAlbumId?: string;
      lidarrAlbumId?: number;
    }
  | {
      kind: "single" | "feature";
      id: string;
      title: string;
      subtitle: string;
      artist: string;
      album?: string;
      image?: string | null;
      trackId: string;
      duration?: number;
      coverPath?: string | null;
    };

export type DiscoverMoreFromShelf = {
  artist: string;
  image?: string | null;
  items: DiscoverMoreFromItem[];
};

export type DiscoverPayload = {
  catalog: DiscoverReleaseCard[];
  releases: DiscoverReleaseCard[];
  artists: DiscoverArtistCard[];
  moreFrom: DiscoverMoreFromShelf[];
  personalized: boolean;
  tracks: [];
  lidarrError: string | null;
  fallbackReady: boolean;
  streamDefault: "fallback" | "library";
};
