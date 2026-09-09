/**
 * Capacitor bridge to the native iOS AVPlayer (`PolarrPlayer`).
 *
 * When available, decode / Now Playing / remote commands live in Swift.
 * Queue, Connect, stream URL building, and EQ stay in JS.
 */

import {
  nativeClientPlatform,
  nativeServerUrl,
  nativeSessionToken,
} from "@/lib/native-client";

export type NativePlayerTrackMeta = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string | null;
  durationHint?: number;
};

export type NativePlayerLoadArgs = {
  url: string;
  track: NativePlayerTrackMeta;
  autoplay?: boolean;
  position?: number;
};

export type NativePlayerState = {
  playing: boolean;
  position: number;
  duration: number;
  trackId?: string | null;
  url?: string | null;
};

export type NativePlayerRemoteAction =
  | "play"
  | "pause"
  | "next"
  | "previous"
  | "seek";

export type NativePlayerBrowseItem = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  url: string;
  artworkUrl?: string | null;
  durationHint?: number;
};

export type NativePlayerEvents = {
  timeupdate: { position: number; duration: number; playing?: boolean };
  playing: NativePlayerState;
  paused: NativePlayerState;
  ended: { trackId?: string | null; advanced?: boolean };
  trackchange: {
    trackId?: string | null;
    url: string;
    title?: string;
    artist?: string;
    album?: string;
    reason?: string;
  };
  error: { code: string; message: string; url?: string };
  remote: {
    action: NativePlayerRemoteAction;
    position?: number;
    handled?: boolean;
  };
};

type NativePlayerPlugin = {
  isAvailable(): Promise<{ available: boolean }>;
  load(options: {
    url: string;
    track: {
      id: string;
      title: string;
      artist: string;
      album?: string;
      artworkUrl?: string;
      token?: string;
      durationHint?: number;
    };
    autoplay?: boolean;
    position?: number;
  }): Promise<{ duration: number; position: number }>;
  play(): Promise<void>;
  pause(): Promise<void>;
  toggle(): Promise<{ playing: boolean }>;
  seek(options: { position: number }): Promise<{ position: number }>;
  stop(): Promise<void>;
  getState(): Promise<NativePlayerState>;
  syncBrowse(options: {
    items: Array<{
      id: string;
      title: string;
      artist: string;
      album?: string;
      url: string;
      artworkUrl?: string;
      token?: string;
      durationHint?: number;
    }>;
    currentId?: string;
  }): Promise<{ count: number }>;
  addListener(
    event: string,
    cb: (data: Record<string, unknown>) => void,
  ): Promise<{ remove: () => void }> | { remove: () => void };
};

let cachedPlugin: NativePlayerPlugin | null | undefined;
let availability: boolean | null = null;
/** True once JS has handed decode ownership to native for this session. */
let owningPlayback = false;

function resolvePlugin(): NativePlayerPlugin | null {
  if (cachedPlugin !== undefined) return cachedPlugin;
  if (typeof window === "undefined" || nativeClientPlatform() !== "ios") {
    cachedPlugin = null;
    return null;
  }
  const nativeWindow = window as Window & {
    Capacitor?: {
      Plugins?: { PolarrPlayer?: NativePlayerPlugin };
      registerPlugin?: (name: string) => NativePlayerPlugin;
    };
  };
  const capacitor = nativeWindow.Capacitor;
  if (!capacitor) {
    cachedPlugin = null;
    return null;
  }
  try {
    cachedPlugin =
      capacitor.Plugins?.PolarrPlayer ||
      capacitor.registerPlugin?.("PolarrPlayer") ||
      null;
  } catch {
    cachedPlugin = null;
  }
  return cachedPlugin;
}

function artworkToken(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const server = nativeServerUrl();
  if (!server) return undefined;
  try {
    if (new URL(url).origin !== new URL(server).origin) return undefined;
    return nativeSessionToken() || undefined;
  } catch {
    return undefined;
  }
}

/** Probe once; returns whether native AVPlayer bridge is present. */
export async function probeNativeIosPlayer(): Promise<boolean> {
  if (availability != null) return availability;
  const native = resolvePlugin();
  if (!native) {
    availability = false;
    return false;
  }
  try {
    const res = await native.isAvailable();
    availability = Boolean(res?.available);
  } catch {
    availability = false;
  }
  return availability;
}

export function isNativeIosPlayerAvailable(): boolean {
  return availability === true && resolvePlugin() != null;
}

/** Native owns Now Playing + decode for the current local session. */
export function isNativeIosPlayerOwning(): boolean {
  return owningPlayback && isNativeIosPlayerAvailable();
}

export function setNativeIosPlayerOwning(next: boolean) {
  owningPlayback = next && isNativeIosPlayerAvailable();
}

export async function nativeIosPlayerLoad(
  args: NativePlayerLoadArgs,
): Promise<{ duration: number; position: number } | null> {
  const native = resolvePlugin();
  if (!native || !(await probeNativeIosPlayer())) return null;
  const token = artworkToken(args.track.artworkUrl);
  const result = await native.load({
    url: args.url,
    autoplay: args.autoplay ?? true,
    ...(Number.isFinite(args.position) ? { position: Number(args.position) } : {}),
    track: {
      id: args.track.id,
      title: args.track.title,
      artist: args.track.artist,
      ...(args.track.album ? { album: args.track.album } : {}),
      ...(args.track.artworkUrl ? { artworkUrl: args.track.artworkUrl } : {}),
      ...(token ? { token } : {}),
      ...(Number.isFinite(args.track.durationHint) &&
      Number(args.track.durationHint) > 0
        ? { durationHint: Number(args.track.durationHint) }
        : {}),
    },
  });
  owningPlayback = true;
  return result;
}

export async function nativeIosPlayerPlay(): Promise<boolean> {
  const native = resolvePlugin();
  if (!native || !isNativeIosPlayerAvailable()) return false;
  await native.play();
  owningPlayback = true;
  return true;
}

export async function nativeIosPlayerPause(): Promise<boolean> {
  const native = resolvePlugin();
  if (!native || !isNativeIosPlayerAvailable()) return false;
  await native.pause();
  return true;
}

export async function nativeIosPlayerSeek(position: number): Promise<number | null> {
  const native = resolvePlugin();
  if (!native || !isNativeIosPlayerAvailable()) return null;
  const res = await native.seek({ position: Math.max(0, position) });
  return Number.isFinite(res?.position) ? Number(res.position) : position;
}

export async function nativeIosPlayerStop(): Promise<void> {
  const native = resolvePlugin();
  if (!native || !isNativeIosPlayerAvailable()) return;
  await native.stop().catch(() => null);
  owningPlayback = false;
}

export async function nativeIosPlayerGetState(): Promise<NativePlayerState | null> {
  const native = resolvePlugin();
  if (!native || !isNativeIosPlayerAvailable()) return null;
  try {
    return await native.getState();
  } catch {
    return null;
  }
}

export async function nativeIosPlayerSyncBrowse(input: {
  items: NativePlayerBrowseItem[];
  currentId?: string | null;
}): Promise<void> {
  const native = resolvePlugin();
  if (!native || !(await probeNativeIosPlayer())) return;
  const items = input.items
    .filter((item) => item.id && item.url && item.title)
    .slice(0, 40)
    .map((item) => {
      const token = artworkToken(item.artworkUrl);
      return {
        id: item.id,
        title: item.title,
        artist: item.artist || "",
        ...(item.album ? { album: item.album } : {}),
        url: item.url,
        ...(item.artworkUrl ? { artworkUrl: item.artworkUrl } : {}),
        ...(token ? { token } : {}),
        ...(Number.isFinite(item.durationHint) && Number(item.durationHint) > 0
          ? { durationHint: Number(item.durationHint) }
          : {}),
      };
    });
  await native
    .syncBrowse({
      items,
      ...(input.currentId ? { currentId: input.currentId } : {}),
    })
    .catch(() => null);
}

type ListenerHandle = { remove: () => void };

export async function subscribeNativeIosPlayer<K extends keyof NativePlayerEvents>(
  event: K,
  handler: (data: NativePlayerEvents[K]) => void,
): Promise<ListenerHandle | null> {
  const native = resolvePlugin();
  if (!native || !(await probeNativeIosPlayer())) return null;
  try {
    const handle = await native.addListener(event, (data) => {
      handler(data as unknown as NativePlayerEvents[K]);
    });
    return handle;
  } catch {
    return null;
  }
}
