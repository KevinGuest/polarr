import {
  clearNativeSessionToken,
  nativeAssetUrl,
  nativeSessionToken,
} from "../../src/lib/native-client";

type NativePlatform = "ios" | "desktop";
type CachedResponse = {
  body: string;
  contentType: string;
  status: number;
  savedAt: number;
};

const CACHE_PREFIX = "polarr_native_cache:";
const originalFetch = window.fetch.bind(window);
let installed = false;

function apiUrl(serverUrl: string, input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === "string" && input.startsWith("/api/")) {
    return new URL(input, `${serverUrl}/`).toString();
  }
  if (input instanceof URL && input.pathname.startsWith("/api/")) {
    return new URL(`${input.pathname}${input.search}`, `${serverUrl}/`);
  }
  return input;
}

function credentialScope(token: string | null) {
  if (!token) return "public";
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `user-${(hash >>> 0).toString(36)}`;
}

function cacheKey(url: string, token: string | null) {
  return `${CACHE_PREFIX}${credentialScope(token)}:${url}`;
}

function cacheResponse(url: string, token: string | null, response: Response) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
  void response.clone().text().then((body) => {
    if (body.length > 1_500_000) return;
    const entry: CachedResponse = {
      body,
      contentType: response.headers.get("content-type") || "application/json",
      status: response.status,
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(cacheKey(url, token), JSON.stringify(entry));
    } catch {
      // Storage may be full; online behavior remains unaffected.
    }
  });
}

function cachedResponse(url: string, token: string | null): Response | null {
  try {
    const raw = localStorage.getItem(cacheKey(url, token));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedResponse;
    return new Response(entry.body, {
      status: entry.status,
      headers: {
        "Content-Type": entry.contentType,
        "X-Polarr-Offline-Cache": "1",
      },
    });
  } catch {
    return null;
  }
}

function absolutizePayload(value: unknown): unknown {
  if (typeof value === "string") return nativeAssetUrl(value) || value;
  if (Array.isArray(value)) return value.map(absolutizePayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        absolutizePayload(child),
      ]),
    );
  }
  return value;
}

function decorateJson(response: Response) {
  const originalJson = response.json.bind(response);
  response.json = async () => absolutizePayload(await originalJson());
  return response;
}

async function refreshMediaTicket() {
  const bridge = window.__POLARR_NATIVE_CLIENT__;
  const token = nativeSessionToken();
  if (!bridge || !token) {
    if (bridge) bridge.mediaTicket = null;
    return;
  }
  try {
    const response = await originalFetch(
      new URL("/api/v1/native/media-ticket", `${bridge.serverUrl}/`).toString(),
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    const data = response.ok ? await response.json() : null;
    bridge.mediaTicket = typeof data?.ticket === "string" ? data.ticket : null;
  } catch {
    bridge.mediaTicket = null;
  }
}

export async function installNativeRuntime(
  serverUrl: string,
  platform: NativePlatform,
  version?: string,
  changeServer?: () => void | Promise<void>,
) {
  const normalized = serverUrl.replace(/\/+$/, "");
  window.__POLARR_NATIVE_CLIENT__ = {
    serverUrl: normalized,
    platform,
    version,
    changeServer,
    mediaTicket: null,
    refreshMediaTicket,
  };
  document.documentElement.classList.add("dark", "polarr-ios");
  document.documentElement.dataset.polarrNative = platform;

  if (!installed) {
    installed = true;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const bridge = window.__POLARR_NATIVE_CLIENT__;
      if (!bridge) return originalFetch(input, init);
      const rewritten = apiUrl(bridge.serverUrl, input);
      const url =
        typeof rewritten === "string"
          ? rewritten
          : rewritten instanceof URL
            ? rewritten.toString()
            : rewritten.url;
      const headers = new Headers(
        rewritten instanceof Request ? rewritten.headers : init?.headers,
      );
      const token = nativeSessionToken();
      if (token && new URL(url).origin === new URL(bridge.serverUrl).origin) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      const method = (init?.method || (rewritten instanceof Request ? rewritten.method : "GET")).toUpperCase();
      try {
        const response = await originalFetch(rewritten, { ...init, headers });
        if (method === "GET") cacheResponse(url, token, response);
        if (response.status === 401 && token) clearNativeSessionToken();
        return decorateJson(response);
      } catch (error) {
        if (method === "GET") {
          const cached = cachedResponse(url, token);
          if (cached) return decorateJson(cached);
        }
        throw error;
      }
    };
  }
  await refreshMediaTicket();
}
