/**
 * Fetch playlist tracks from streaming service URLs (no CSV export).
 * Spotify · YouTube Music · Deezer (+ Apple Music when MusicKit is configured).
 */

import { spawn } from "node:child_process";
import { getSettings } from "@/lib/db";
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

function spotifyPlaylistId(url: string): string | null {
  const trimmed = url.trim();
  const uri = trimmed.match(/spotify:playlist:([a-zA-Z0-9]+)/i);
  if (uri?.[1]) return uri[1];
  try {
    const u = new URL(trimmed);
    const m = u.pathname.match(/\/playlist\/([a-zA-Z0-9]+)/i);
    return m?.[1] || null;
  } catch {
    return null;
  }
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

let spotifyTokenCache: { token: string; exp: number } | null = null;

async function spotifyAccessToken(): Promise<string | null> {
  const s = getSettings();
  const id = s.spotifyClientId.trim();
  const secret = s.spotifyClientSecret.trim();
  if (!id || !secret) return null;

  if (spotifyTokenCache && Date.now() < spotifyTokenCache.exp - 60_000) {
    return spotifyTokenCache.token;
  }

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return null;
  spotifyTokenCache = {
    token: data.access_token,
    exp: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return data.access_token;
}

export function spotifyImportConfigured(): boolean {
  const s = getSettings();
  return Boolean(s.spotifyClientId.trim() && s.spotifyClientSecret.trim());
}

async function fetchSpotifyPlaylist(
  url: string,
): Promise<RemotePlaylist | { error: string }> {
  if (!spotifyImportConfigured()) {
    return {
      error:
        "Spotify import needs API credentials. Ask an admin to add a Spotify Client ID & Secret under Admin → Import (or set POLARR_SPOTIFY_CLIENT_ID / POLARR_SPOTIFY_CLIENT_SECRET).",
    };
  }
  const id = spotifyPlaylistId(url);
  if (!id) {
    return {
      error: "That doesn’t look like a Spotify playlist link.",
    };
  }
  const token = await spotifyAccessToken();
  if (!token) {
    return {
      error: "Couldn’t authenticate with Spotify. Check the Client ID & Secret.",
    };
  }

  type SpotTrack = {
    name?: string;
    artists?: { name?: string }[];
    album?: { name?: string };
  };

  const metaRes = await fetch(
    `https://api.spotify.com/v1/playlists/${id}?fields=name`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (metaRes.status === 404) {
    return { error: "Playlist not found (is it public?)." };
  }
  if (!metaRes.ok) {
    return { error: `Spotify returned ${metaRes.status}. Try again later.` };
  }
  const meta = (await metaRes.json()) as { name?: string };
  const name = (meta.name || "Spotify playlist").trim();

  const tracks: ImportTrackRow[] = [];
  let nextUrl: string | null =
    `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&fields=items(track(name,artists(name),album(name))),next`;

  while (nextUrl && tracks.length < PLAYLIST_IMPORT_MAX) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { error: `Spotify returned ${res.status} while loading tracks.` };
    }
    const data = (await res.json()) as {
      items?: { track?: SpotTrack | null }[];
      next?: string | null;
    };
    for (const item of data.items || []) {
      const t = item.track;
      if (!t?.name) continue;
      const artist = (t.artists || [])
        .map((a) => a.name || "")
        .filter(Boolean)
        .join(", ");
      if (!artist) continue;
      tracks.push({
        title: t.name.trim(),
        artist: artist.trim(),
        album: t.album?.name?.trim() || undefined,
      });
      if (tracks.length >= PLAYLIST_IMPORT_MAX) break;
    }
    nextUrl = data.next || null;
  }

  if (tracks.length === 0) {
    return {
      error:
        "No tracks on that playlist (private playlists need a different setup).",
    };
  }
  return { name, tracks, service: "spotify" };
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
  return { name, tracks, service: "deezer" };
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
  return {
    name: (data.title || "YouTube playlist").trim(),
    tracks,
    service: "youtube",
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
  if (detected && detected !== service) {
    return {
      error: `That link looks like ${detected}, not ${service}. Pick the matching service.`,
    };
  }

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
