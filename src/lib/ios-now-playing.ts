import { nativeClientPlatform, nativeServerUrl, nativeSessionToken } from "@/lib/native-client";
import { isNativeIosPlayerOwning } from "@/lib/ios-player";

type NativeNowPlayingPlugin = {
  setMetadata(options: {
    title: string;
    artist: string;
    album: string;
    artworkUrl?: string;
    token?: string;
  }): Promise<unknown>;
  setPlayback(options: {
    playing: boolean;
    position?: number;
    duration?: number;
    rate?: number;
  }): Promise<unknown>;
  clear(): Promise<unknown>;
};

function plugin(): NativeNowPlayingPlugin | null {
  if (typeof window === "undefined" || nativeClientPlatform() !== "ios") return null;
  const nativeWindow = window as Window & {
    Capacitor?: {
      Plugins?: { PolarrNowPlaying?: NativeNowPlayingPlugin };
      registerPlugin?: (name: string) => NativeNowPlayingPlugin;
    };
  };
  const capacitor = nativeWindow.Capacitor;
  if (!capacitor) return null;
  if (capacitor.Plugins?.PolarrNowPlaying) return capacitor.Plugins.PolarrNowPlaying;
  try {
    return capacitor.registerPlugin?.("PolarrNowPlaying") || null;
  } catch {
    return null;
  }
}

function artworkToken(url: string | null): string | undefined {
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

export function setNativeNowPlayingMetadata(input: {
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
}) {
  // Native AVPlayer path owns MPNowPlayingInfoCenter exclusively.
  if (isNativeIosPlayerOwning()) return;
  const native = plugin();
  if (!native) return;
  const token = artworkToken(input.artworkUrl);
  void native.setMetadata({
    title: input.title,
    artist: input.artist,
    album: input.album,
    ...(input.artworkUrl ? { artworkUrl: input.artworkUrl } : {}),
    ...(token ? { token } : {}),
  }).catch(() => null);
}

let lastPlaybackSync = 0;
let lastPosition = -1;

export function setNativeNowPlayingPlayback(input: {
  playing: boolean;
  position?: number;
  duration?: number;
  rate?: number;
  force?: boolean;
}) {
  if (isNativeIosPlayerOwning()) return;
  const native = plugin();
  if (!native) return;
  const now = Date.now();
  const position = Number(input.position);
  if (
    !input.force &&
    Number.isFinite(position) &&
    now - lastPlaybackSync < 800 &&
    Math.abs(position - lastPosition) < 0.75
  ) {
    return;
  }
  lastPlaybackSync = now;
  if (Number.isFinite(position)) lastPosition = position;
  void native.setPlayback({
    playing: input.playing,
    ...(Number.isFinite(position) ? { position: Math.max(0, position) } : {}),
    ...(Number.isFinite(input.duration) && Number(input.duration) > 0
      ? { duration: Number(input.duration) }
      : {}),
    ...(Number.isFinite(input.rate) && Number(input.rate) > 0
      ? { rate: Number(input.rate) }
      : {}),
  }).catch(() => null);
}

export function clearNativeNowPlaying() {
  lastPlaybackSync = 0;
  lastPosition = -1;
  if (isNativeIosPlayerOwning()) return;
  const native = plugin();
  if (!native) return;
  void native.clear().catch(() => null);
}
