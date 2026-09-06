const NATIVE_TOKEN_KEY = "polarr_native_token";

/** Device class for Discord/admin alerts (notification metadata only). */
export type NativeMobilePlatform = "iphone" | "ipad";
export type NativeDesktopPlatform = "windows" | "macos" | "linux";

type NativeClientBridge = {
  serverUrl: string;
  platform: "ios" | "desktop";
  /** iPhone vs iPad when `platform` is `"ios"`. */
  mobilePlatform?: NativeMobilePlatform;
  desktopPlatform?: NativeDesktopPlatform;
  version?: string;
  changeServer?: () => void | Promise<void>;
  mediaTicket?: string | null;
  mediaTicketExpiresAt?: number | null;
  refreshMediaTicket?: () => Promise<void>;
};

declare global {
  interface Window {
    __POLARR_NATIVE_CLIENT__?: NativeClientBridge;
  }
}

/** API paths that HTML media/img cannot authorize with Bearer headers. */
const NATIVE_MEDIA_PATH =
  /^\/api\/(stream\/|live\/|lidarr\/cover|playlists\/[^/]+\/cover|profiles\/avatar\/|karaoke\/[^/]+\/stream)/;

export function isNativeClient(): boolean {
  return typeof window !== "undefined" && Boolean(window.__POLARR_NATIVE_CLIENT__);
}

export function nativeServerUrl(): string | null {
  if (typeof window === "undefined") return null;
  return window.__POLARR_NATIVE_CLIENT__?.serverUrl || null;
}

export function nativeClientPlatform(): "ios" | "desktop" | null {
  if (typeof window === "undefined") return null;
  return window.__POLARR_NATIVE_CLIENT__?.platform || null;
}

export function nativeMobilePlatform(): NativeMobilePlatform | null {
  if (typeof window === "undefined") return null;
  return window.__POLARR_NATIVE_CLIENT__?.mobilePlatform || null;
}

/**
 * iPhone vs iPad for notification labels. iPadOS 13+ often reports as Mac;
 * touch points distinguish those tablets from real Macs.
 */
export function detectIosMobilePlatform(): NativeMobilePlatform {
  if (typeof navigator === "undefined") return "iphone";
  const ua = navigator.userAgent || "";
  if (/iPad/i.test(ua)) return "ipad";
  if (/iPhone|iPod/i.test(ua)) return "iphone";
  const platform = navigator.platform || "";
  if (
    /Mac/i.test(platform) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  ) {
    return "ipad";
  }
  return "iphone";
}

export function detectNativeDesktopPlatform(): NativeDesktopPlatform {
  if (typeof navigator === "undefined") return "linux";
  const agent = `${navigator.userAgent || ""} ${navigator.platform || ""}`;
  if (/Windows/i.test(agent)) return "windows";
  if (/Macintosh|Mac OS X|MacIntel/i.test(agent)) return "macos";
  return "linux";
}

export function nativeClientVersion(): string | null {
  if (typeof window === "undefined") return null;
  return window.__POLARR_NATIVE_CLIENT__?.version?.trim() || null;
}

export function requestNativeServerChange(): void {
  if (typeof window === "undefined") return;
  const changeServer = window.__POLARR_NATIVE_CLIENT__?.changeServer;
  if (changeServer) queueMicrotask(() => void changeServer());
}

export function nativeSessionToken(): string | null {
  if (!isNativeClient()) return null;
  return localStorage.getItem(NATIVE_TOKEN_KEY);
}

export async function persistNativeSessionToken(token: unknown): Promise<void> {
  if (!isNativeClient() || typeof token !== "string" || !token.trim()) return;
  localStorage.setItem(NATIVE_TOKEN_KEY, token.trim());
  await window.__POLARR_NATIVE_CLIENT__?.refreshMediaTicket?.();
}

export function clearNativeSessionToken(): void {
  if (!isNativeClient()) return;
  localStorage.removeItem(NATIVE_TOKEN_KEY);
  if (window.__POLARR_NATIVE_CLIENT__) {
    window.__POLARR_NATIVE_CLIENT__.mediaTicket = null;
    window.__POLARR_NATIVE_CLIENT__.mediaTicketExpiresAt = null;
  }
}

export function isNativeMediaPath(pathname: string): boolean {
  return NATIVE_MEDIA_PATH.test(pathname);
}

export async function ensureNativeMediaTicket(): Promise<string | null> {
  if (!isNativeClient()) return null;
  const bridge = window.__POLARR_NATIVE_CLIENT__;
  const expiresAt = bridge?.mediaTicketExpiresAt || 0;
  if (!bridge?.mediaTicket || (expiresAt > 0 && expiresAt <= Date.now() + 60_000)) {
    await window.__POLARR_NATIVE_CLIENT__?.refreshMediaTicket?.();
  }
  return window.__POLARR_NATIVE_CLIENT__?.mediaTicket || null;
}

/**
 * Resolve a server asset for the native WebView.
 * Protected media paths get an opaque `mediaTicket` so <audio>/<img> can
 * authenticate without Authorization headers.
 */
export function nativeAssetUrl(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  const server = nativeServerUrl();
  if (!server) return value;

  let url: URL;
  try {
    if (/^\/(api|uploads)\//.test(value)) {
      url = new URL(value, `${server}/`);
    } else if (/^https?:\/\//i.test(value)) {
      url = new URL(value);
      if (url.origin !== new URL(server).origin) return value;
    } else {
      return value;
    }
  } catch {
    return value;
  }

  if (isNativeMediaPath(url.pathname)) {
    const ticket = window.__POLARR_NATIVE_CLIENT__?.mediaTicket;
    if (ticket) url.searchParams.set("mediaTicket", ticket);
  }
  return url.toString();
}
