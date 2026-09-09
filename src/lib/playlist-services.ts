/**
 * Fetch playlist/album tracks from public streaming URLs (user Account import).
 * Spotify · YouTube Music · Deezer (+ Apple Music when MusicKit is configured).
 */

import { spawn } from "node:child_process";
import { ensureYtDlp } from "@/lib/tools";
import {
  PLAYLIST_IMPORT_MAX,
  type ImportTrackRow,
} from "@/lib/playlist-import";

export type PlaylistService =
  | "spotify"
  | "youtube"
  | "deezer"
  | "apple";

export type RemotePlaylist = {
  name: string;
  tracks: ImportTrackRow[];
  service: PlaylistService;
  /** Public cover image URL when the source playlist/album has one. */
  coverUrl?: string | null;
};

function runYtDlp(
  ytDlp: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlp, args, {
      shell: false,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString();
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function detectPlaylistService(url: string): PlaylistService | null {
  const u = url.trim().toLowerCase();
  if (!u) return null;
  if (u.includes("spotify.com") || u.startsWith("spotify:")) return "spotify";
  if (
    u.includes("music.youtube.com") ||
    u.includes("youtube.com") ||
    u.includes("youtu.be")
  ) {
    return "youtube";
  }
  if (u.includes("deezer.com")) return "deezer";
  if (u.includes("music.apple.com") || u.includes("itunes.apple.com")) {
    return "apple";
  }
  return null;
}

/** Hostnames yt-dlp / HTTP fetch may contact for playlist import. */
function isAllowedPlaylistHost(hostname: string, service: PlaylistService): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  if (service === "spotify") {
    return (
      h === "open.spotify.com" ||
      h === "spotify.com" ||
      h.endsWith(".spotify.com")
    );
  }
  if (service === "youtube") {
    return (
      h === "youtube.com" ||
      h === "www.youtube.com" ||
      h === "m.youtube.com" ||
      h === "music.youtube.com" ||
      h === "youtu.be" ||
      h === "www.youtu.be"
    );
  }
  if (service === "deezer") {
    return h === "deezer.com" || h === "www.deezer.com" || h.endsWith(".deezer.com");
  }
  if (service === "apple") {
    return (
      h === "music.apple.com" ||
      h === "itunes.apple.com" ||
      h.endsWith(".apple.com")
    );
  }
  return false;
}

function assertSafePlaylistUrl(
  service: PlaylistService,
  url: string,
): string | null {
  const trimmed = url.trim();
  if (service === "spotify" && trimmed.toLowerCase().startsWith("spotify:")) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "That playlist link isn’t a valid URL.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Playlist links must be http(s).";
  }
  if (!isAllowedPlaylistHost(parsed.hostname, service)) {
    return `That host isn’t allowed for ${service} imports.`;
  }
  return null;
}

type SpotifyEmbedKind = "playlist" | "album";

function spotifyEmbedTarget(
  url: string,
): { kind: SpotifyEmbedKind; id: string } | null {
  const trimmed = url.trim();
  const uri = trimmed.match(/spotify:(playlist|album):([a-zA-Z0-9]+)/i);
  if (uri?.[1] && uri[2]) {
    return { kind: uri[1].toLowerCase() as SpotifyEmbedKind, id: uri[2] };
  }
  try {
    const u = new URL(trimmed);
    const m = u.pathname.match(/\/(playlist|album)\/([a-zA-Z0-9]+)/i);
    if (m?.[1] && m[2]) {
      return { kind: m[1].toLowerCase() as SpotifyEmbedKind, id: m[2] };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function deezerPlaylistId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const m = u.pathname.match(/\/playlist\/(\d+)/i);
    return m?.[1] || null;
  } catch {
    const bare = url.trim().match(/deezer\.com\/(?:[a-z]{2}\/)?playlist\/(\d+)/i);
    return bare?.[1] || null;
  }
}

/** Paste-a-link Spotify import — no admin credentials. */
export function spotifyImportReady(): boolean {
  return true;
}

/**
 * User-facing public playlist/album import via Spotify’s embed page
 * (`__NEXT_DATA__` trackList). No Client ID / Secret.
 */
async function fetchSpotifyFromEmbed(
  kind: SpotifyEmbedKind,
  id: string,
): Promise<RemotePlaylist | { error: string }> {
  const label = kind === "album" ? "album" : "playlist";
  const embedUrl = `https://open.spotify.com/embed/${kind}/${encodeURIComponent(id)}`;
  const res = await fetch(embedUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) {
    return {
      error: `${label[0]!.toUpperCase()}${label.slice(1)} not found (is the link public?).`,
    };
  }
  if (!res.ok) {
    return { error: `Spotify returned ${res.status}. Try again later.` };
  }

  const html = await res.text();
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match?.[1]) {
    return {
      error: `Couldn’t read that Spotify ${label}. Make sure the link is public.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { error: `Couldn’t parse the Spotify ${label} response.` };
  }

  const pageProps = (
    parsed as {
      props?: {
        pageProps?: {
          status?: number;
          state?: {
            data?: {
              entity?: {
                name?: string;
                title?: string;
                coverArt?: {
                  sources?: { url?: string; height?: number | null; width?: number | null }[];
                };
                visualIdentity?: {
                  image?: { url?: string; maxHeight?: number; maxWidth?: number }[];
                };
                trackList?: {
                  title?: string;
                  subtitle?: string;
                  entityType?: string;
                }[];
              };
            };
          };
        };
      };
    }
  )?.props?.pageProps;

  if (pageProps?.status === 404) {
    return {
      error: `${label[0]!.toUpperCase()}${label.slice(1)} not found (is the link public?).`,
    };
  }

  const entity = pageProps?.state?.data?.entity;
  const trackList = entity?.trackList;
  if (!Array.isArray(trackList) || trackList.length === 0) {
    return {
      error: `No tracks on that ${label} (private links aren’t readable from a URL alone).`,
    };
  }

  const tracks: ImportTrackRow[] = [];
  const albumName =
    kind === "album"
      ? (entity?.name || entity?.title || "").trim() || undefined
      : undefined;
  for (const row of trackList) {
    if (row.entityType && row.entityType !== "track") continue;
    const title = (row.title || "").trim();
    const artist = (row.subtitle || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || !artist) continue;
    tracks.push({
      title,
      artist,
      album: albumName,
    });
    if (tracks.length >= PLAYLIST_IMPORT_MAX) break;
  }

  if (tracks.length === 0) {
    return { error: `No usable tracks found on that Spotify ${label}.` };
  }

  const name = (
    entity?.name ||
    entity?.title ||
    (kind === "album" ? "Spotify album" : "Spotify playlist")
  ).trim();

  const coverSources = [
    ...(entity?.coverArt?.sources || []).map((s) => ({
      url: s.url,
      size: Math.max(s.height || 0, s.width || 0),
    })),
    ...(entity?.visualIdentity?.image || []).map((s) => ({
      url: s.url,
      size: Math.max(s.maxHeight || 0, s.maxWidth || 0),
    })),
  ]
    .filter((s): s is { url: string; size: number } => Boolean(s.url?.trim()))
    .sort((a, b) => b.size - a.size);
  const coverUrl = coverSources[0]?.url?.trim() || null;

  return { name, tracks, service: "spotify", coverUrl };
}

async function fetchSpotifyPlaylist(
  url: string,
): Promise<RemotePlaylist | { error: string }> {
  const target = spotifyEmbedTarget(url);
  if (!target) {
    return {
      error: "Paste a Spotify playlist or album link.",
    };
  }
  return fetchSpotifyFromEmbed(target.kind, target.id);
}

async function fetchDeezerPlaylist(
  url: string,
): Promise<RemotePlaylist | { error: string }> {
  const id = deezerPlaylistId(url);
  if (!id) {
    return { error: "That doesn’t look like a Deezer playlist link." };
  }

  const tracks: ImportTrackRow[] = [];
  let name = "Deezer playlist";
  let coverUrl: string | null = null;
  let index = 0;

  while (tracks.length < PLAYLIST_IMPORT_MAX) {
    const endpoint =
      index === 0
        ? `https://api.deezer.com/playlist/${id}`
        : `https://api.deezer.com/playlist/${id}/tracks?index=${index}`;
    const res = await fetch(endpoint, {
      headers: { Accept: "application/json", "User-Agent": "Polarr/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return { error: `Deezer returned ${res.status}.` };
    }
    const data = (await res.json()) as {
      error?: { message?: string };
      title?: string;
      picture_xl?: string;
      picture_big?: string;
      picture_medium?: string;
      picture?: string;
      tracks?: {
        data?: {
          title?: string;
          artist?: { name?: string };
          album?: { title?: string };
        }[];
        next?: string;
      };
      data?: {
        title?: string;
        artist?: { name?: string };
        album?: { title?: string };
      }[];
      next?: string;
    };
    if (data.error?.message) {
      return { error: data.error.message };
    }
    if (data.title) name = data.title;
    if (index === 0) {
      coverUrl =
        data.picture_xl?.trim() ||
        data.picture_big?.trim() ||
        data.picture_medium?.trim() ||
        data.picture?.trim() ||
        null;
    }

    const items = data.tracks?.data || data.data || [];
    if (items.length === 0) break;
    for (const t of items) {
      const title = (t.title || "").trim();
      const artist = (t.artist?.name || "").trim();
      if (!title || !artist) continue;
      tracks.push({
        title,
        artist,
        album: t.album?.title?.trim() || undefined,
      });
      if (tracks.length >= PLAYLIST_IMPORT_MAX) break;
    }

    const hasNext = Boolean(data.tracks?.next || data.next);
    if (!hasNext) break;
    index += items.length;
  }

  if (tracks.length === 0) {
    return { error: "No tracks on that Deezer playlist." };
  }
  return { name, tracks, service: "deezer", coverUrl };
}

async function fetchYoutubePlaylist(
  url: string,
): Promise<RemotePlaylist | { error: string }> {
  const ytDlp = await ensureYtDlp();
  if (!ytDlp) {
    return {
      error: "yt-dlp isn’t available on this server, so YouTube playlists can’t be imported yet.",
    };
  }

  const result = await runYtDlp(ytDlp, [
    url.trim(),
    "--flat-playlist",
    "-J",
    "--no-warnings",
    "--playlist-end",
    String(PLAYLIST_IMPORT_MAX),
  ]);
  if (result.code !== 0) {
    return {
      error:
        "Couldn’t read that YouTube / YouTube Music playlist. Make sure the link is public.",
    };
  }

  let data: {
    title?: string;
    thumbnail?: string;
    thumbnails?: { url?: string; height?: number; width?: number }[];
    entries?: {
      title?: string;
      artist?: string;
      uploader?: string;
      creators?: string[];
      track?: string;
      album?: string;
    }[];
  };
  try {
    data = JSON.parse(result.stdout);
  } catch {
    return { error: "Couldn’t parse the YouTube playlist response." };
  }

  const tracks: ImportTrackRow[] = [];
  for (const e of data.entries || []) {
    const title = (e.track || e.title || "").trim();
    const artist = (
      e.artist ||
      e.creators?.[0] ||
      e.uploader ||
      ""
    ).trim();
    if (!title) continue;
    // Many YT Music entries are "Artist - Title" in the title field
    if (!artist && title.includes(" - ")) {
      const [a, ...rest] = title.split(" - ");
      tracks.push({
        artist: a.trim(),
        title: rest.join(" - ").trim(),
        album: e.album?.trim() || undefined,
      });
    } else if (artist) {
      tracks.push({
        title,
        artist,
        album: e.album?.trim() || undefined,
      });
    } else {
      tracks.push({ title, artist: "Unknown Artist" });
    }
    if (tracks.length >= PLAYLIST_IMPORT_MAX) break;
  }

  if (tracks.length === 0) {
    return { error: "No tracks found on that YouTube playlist." };
  }

  const thumbs = [...(data.thumbnails || [])]
    .filter((t) => t.url?.trim())
    .sort(
      (a, b) =>
        Math.max(b.height || 0, b.width || 0) -
        Math.max(a.height || 0, a.width || 0),
    );
  const coverUrl = thumbs[0]?.url?.trim() || data.thumbnail?.trim() || null;

  return {
    name: (data.title || "YouTube playlist").trim(),
    tracks,
    service: "youtube",
    coverUrl,
  };
}

async function fetchApplePlaylist(
  _url: string,
): Promise<RemotePlaylist | { error: string }> {
  return {
    error:
      "Apple Music playlist links aren’t supported yet (needs a MusicKit token). Use Spotify, YouTube Music, or Deezer for now.",
  };
}

/** Pull tracks from a public playlist URL on the given service. */
export async function fetchRemotePlaylist(
  service: PlaylistService,
  url: string,
): Promise<RemotePlaylist | { error: string }> {
  const trimmed = url.trim();
  if (!trimmed) return { error: "Paste a playlist link." };

  const detected = detectPlaylistService(trimmed);
  if (detected !== service) {
    if (detected) {
      return {
        error: `That link looks like ${detected}, not ${service}. Pick the matching service.`,
      };
    }
    return {
      error:
        "Paste a recognized Spotify, YouTube / YouTube Music, Deezer, or Apple Music playlist link.",
    };
  }

  const unsafe = assertSafePlaylistUrl(service, trimmed);
  if (unsafe) return { error: unsafe };

  switch (service) {
    case "spotify":
      return fetchSpotifyPlaylist(trimmed);
    case "deezer":
      return fetchDeezerPlaylist(trimmed);
    case "youtube":
      return fetchYoutubePlaylist(trimmed);
    case "apple":
      return fetchApplePlaylist(trimmed);
    default:
      return { error: "Unknown service." };
  }
}
