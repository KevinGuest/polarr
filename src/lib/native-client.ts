const NATIVE_TOKEN_KEY = "polarr_native_token";

type NativeClientBridge = {
  serverUrl: string;
  platform: "ios" | "desktop";
  version?: string;
  changeServer?: () => void | Promise<void>;
  mediaTicket?: string | null;
  refreshMediaTicket?: () => Promise<void>;
};

declare global {
  interface Window {
    __POLARR_NATIVE_CLIENT__?: NativeClientBridge;
  }
}

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
  }
}

export function nativeAssetUrl(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  const server = nativeServerUrl();
  // Keep application routes local to the bundled client. Only server-backed
  // resources should escape the native WebView and resolve against the server.
  if (!server || !/^\/(api|uploads)\//.test(value)) return value;
  const url = new URL(value, `${server}/`);
  if (/^\/api\/(stream\/|live\/|lidarr\/cover|playlists\/[^/]+\/cover|profiles\/avatar\/|karaoke\/[^/]+\/stream)/.test(url.pathname)) {
    const ticket = window.__POLARR_NATIVE_CLIENT__?.mediaTicket;
    if (ticket) url.searchParams.set("mediaTicket", ticket);
  }
  return url.toString();
}
