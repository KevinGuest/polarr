import {
  clearNativeSessionToken,
  detectNativeDesktopPlatform,
  detectIosMobilePlatform,
  nativeAssetUrl,
  nativeSessionToken,
} from "../../src/lib/native-client";
import {
  deleteMutation,
  getArtwork,
  getStoredResponse,
  listMutations,
  mutateStoredJson,
  putArtwork,
  putMutation,
  putStoredResponse,
  updateMutationAttempts,
  type QueuedMutation,
} from "./offline-store";

type NativePlatform = "ios" | "desktop";
type CachedResponse = {
  body: string;
  contentType: string;
  status: number;
  savedAt: number;
};
type QueuePlan = { id: string; response: Record<string, unknown> };

const LEGACY_CACHE_PREFIX = "polarr_native_cache:";
const MAX_JSON_BYTES = 30_000_000;
const MAX_ARTWORK_BYTES = 12_000_000;
const originalFetch = window.fetch.bind(window);
const artworkUrls = new Map<string, string>();
let installed = false;
let flushing = false;
let warming = false;

type CapacitorHttpPlugin = {
  request(options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: string | Record<string, unknown> | null;
    responseType?: "text" | "json" | "arraybuffer" | "blob";
    connectTimeout?: number;
    readTimeout?: number;
  }): Promise<{
    status: number;
    data: unknown;
    headers: Record<string, string>;
    url: string;
  }>;
};

function apiUrl(serverUrl: string, input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === "string" && input.startsWith("/api/")) {
    return new URL(input, `${serverUrl}/`).toString();
  }
  if (input instanceof URL && input.pathname.startsWith("/api/")) {
    return new URL(`${input.pathname}${input.search}`, `${serverUrl}/`);
  }
  return input;
}

/** iOS WKWebView fetch is CORS-bound; CapacitorHttp talks to the server natively. */
function getCapacitorHttp(): CapacitorHttpPlugin | null {
  if (typeof window === "undefined") return null;
  if (window.__POLARR_NATIVE_CLIENT__?.platform !== "ios") return null;
  const cap = (
    window as Window & {
      Capacitor?: {
        isNativePlatform?: () => boolean;
        Plugins?: { CapacitorHttp?: CapacitorHttpPlugin };
      };
      CapacitorHttp?: CapacitorHttpPlugin;
    }
  );
  if (cap.Capacitor?.isNativePlatform && !cap.Capacitor.isNativePlatform()) return null;
  return cap.CapacitorHttp || cap.Capacitor?.Plugins?.CapacitorHttp || null;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function serverFetch(url: string, init?: RequestInit): Promise<Response> {
  const http = getCapacitorHttp();
  const headers = new Headers(init?.headers);
  const mobilePlatform = window.__POLARR_NATIVE_CLIENT__?.mobilePlatform;
  const desktopPlatform = window.__POLARR_NATIVE_CLIENT__?.desktopPlatform;
  if (mobilePlatform) {
    headers.set("x-polarr-mobile-platform", mobilePlatform);
  }
  if (desktopPlatform) {
    headers.set("x-polarr-desktop-platform", desktopPlatform);
  }
  if (!http) return originalFetch(url, { ...init, headers });

  const method = (init?.method || "GET").toUpperCase();
  let data: string | null = null;
  if (method !== "GET" && method !== "HEAD") {
    if (typeof init?.body === "string") data = init.body;
    else if (init?.body != null) data = String(init.body);
  }

  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const wantsBinary =
    method === "GET" &&
    (path.startsWith("/uploads/") ||
      path.includes("/cover") ||
      path.includes("/avatar") ||
      /\.(avif|gif|jpe?g|png|webp)$/i.test(path));

  const result = await http.request({
    url,
    method,
    headers: headersToRecord(headers),
    data,
    responseType: wantsBinary ? "blob" : "text",
    // Avoid hung album/Lidarr calls blocking the UI forever on iOS.
    connectTimeout: 15_000,
    readTimeout: 60_000,
  });

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(result.headers || {})) {
    if (value != null) responseHeaders.set(key, String(value));
  }

  if (wantsBinary) {
    let body: Blob;
    if (result.data instanceof Blob) {
      body = result.data;
    } else if (typeof result.data === "string") {
      // Native bridge may base64-encode binary payloads.
      const binary = atob(result.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      body = new Blob([bytes], {
        type: responseHeaders.get("content-type") || "application/octet-stream",
      });
    } else if (result.data == null) {
      body = new Blob();
    } else {
      body = new Blob([JSON.stringify(result.data)]);
    }
    return new Response(body, { status: result.status, headers: responseHeaders });
  }

  let body: string;
  if (typeof result.data === "string") body = result.data;
  else if (result.data == null) body = "";
  else body = JSON.stringify(result.data);

  if (!responseHeaders.has("content-type") && body && (body.startsWith("{") || body.startsWith("["))) {
    responseHeaders.set("content-type", "application/json");
  }

  return new Response(body, { status: result.status, headers: responseHeaders });
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
  return `${credentialScope(token)}:${url}`;
}

function legacyCacheKey(url: string, token: string | null) {
  return `${LEGACY_CACHE_PREFIX}${credentialScope(token)}:${url}`;
}

function cacheResponse(url: string, token: string | null, response: Response) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
  void response.clone().text().then(async (body) => {
    if (body.length > MAX_JSON_BYTES) return;
    const entry: CachedResponse & { key: string } = {
      key: cacheKey(url, token),
      body,
      contentType: response.headers.get("content-type") || "application/json",
      status: response.status,
      savedAt: Date.now(),
    };
    try {
      await putStoredResponse(entry);
      localStorage.removeItem(legacyCacheKey(url, token));
    } catch {
      if (body.length <= 1_500_000) {
        try {
          localStorage.setItem(legacyCacheKey(url, token), JSON.stringify(entry));
        } catch {
          // Storage may be full; online behavior remains unaffected.
        }
      }
    }
  });
}

async function cachedResponse(url: string, token: string | null): Promise<Response | null> {
  let entry: CachedResponse | null = null;
  try {
    entry = await getStoredResponse(cacheKey(url, token));
  } catch {
    // Older WebViews can still use the legacy cache below.
  }
  if (!entry) {
    try {
      const raw = localStorage.getItem(legacyCacheKey(url, token));
      entry = raw ? (JSON.parse(raw) as CachedResponse) : null;
    } catch {
      entry = null;
    }
  }
  if (!entry) return null;
  return new Response(entry.body, {
    status: entry.status,
    headers: {
      "Content-Type": entry.contentType,
      "X-Polarr-Offline-Cache": "1",
      "X-Polarr-Cached-At": String(entry.savedAt),
    },
  });
}

/** Prefer IndexedDB while online; use `cache: "no-store"` / `reload` or header to force network. */
function shouldBypassCache(init?: RequestInit, headers?: Headers): boolean {
  if (init?.cache === "no-store" || init?.cache === "reload") return true;
  const value = (headers || new Headers(init?.headers)).get("x-polarr-cache");
  return value === "bypass";
}

function revalidateInBackground(
  url: string,
  token: string | null,
  init: RequestInit | undefined,
  headers: Headers,
  method: string,
  body: string,
) {
  void (async () => {
    try {
      const freshHeaders = new Headers(headers);
      freshHeaders.set("x-polarr-cache", "bypass");
      const response = await serverFetch(url, {
        ...init,
        method,
        headers: freshHeaders,
        body: body || undefined,
      });
      if (method === "GET") cacheResponse(url, token, response);
      if (response.status === 401 && token) clearNativeSessionToken();
      if (response.ok) {
        // Seed discover module cache so home can apply without another wait.
        try {
          const path = new URL(url).pathname;
          if (path === "/api/discover") {
            const data = await response.clone().json();
            const { seedDiscoverCache } = await import("../../src/lib/discover-client");
            seedDiscoverCache(data);
          }
        } catch {
          /* ignore */
        }
        const { emitApiRevalidated } = await import("../../src/lib/ui-events");
        emitApiRevalidated(url);
      }
    } catch {
      // Stale cache already served; keep it.
    }
  })();
}

function artworkKey(url: string) {
  const parsed = new URL(url);
  parsed.searchParams.delete("mediaTicket");
  return parsed.toString();
}

function isArtworkUrl(url: string) {
  try {
    const path = url.startsWith("/")
      ? url.split("?")[0] || url
      : new URL(url).pathname;
    return path.startsWith("/uploads/") || path.includes("/cover") || path.includes("/avatar") || /\.(avif|gif|jpe?g|png|webp)$/i.test(path);
  } catch {
    return false;
  }
}

async function cacheArtwork(url: string, token: string | null) {
  if (!isArtworkUrl(url)) return;
  const key = artworkKey(url);
  try {
    if (await getArtwork(key)) return;
  } catch {
    return;
  }
  try {
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    // Use native HTTP on iOS so protected cross-origin artwork is not blocked
    // by WKWebView CORS. `serverFetch` decodes Capacitor's base64 blob result.
    const response = await serverFetch(url, { headers });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.startsWith("image/")) return;
    const blob = await response.blob();
    if (blob.size > MAX_ARTWORK_BYTES) return;
    await putArtwork(key, blob);
  } catch {
    // Artwork caching is best-effort and never blocks the live UI.
  }
}

async function cachedArtworkUrl(url: string): Promise<string> {
  const key = artworkKey(url);
  const existing = artworkUrls.get(key);
  if (existing) return existing;
  try {
    const blob = await getArtwork(key);
    if (!blob) return url;
    const objectUrl = URL.createObjectURL(blob);
    artworkUrls.set(key, objectUrl);
    return objectUrl;
  } catch {
    return url;
  }
}

async function absolutizePayload(value: unknown, offline: boolean, token: string | null): Promise<unknown> {
  if (typeof value === "string") {
    const absolute = nativeAssetUrl(value) || value;
    if (!isArtworkUrl(absolute)) return absolute;
    if (offline) return cachedArtworkUrl(absolute);
    void cacheArtwork(absolute, token);
    return absolute;
  }
  if (Array.isArray(value)) return Promise.all(value.map((child) => absolutizePayload(child, offline, token)));
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([key, child]) => [
        key,
        await absolutizePayload(child, offline, token),
      ] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

function decorateJson(response: Response, token: string | null) {
  const originalJson = response.json.bind(response);
  response.json = async () => absolutizePayload(
    await originalJson(),
    response.headers.get("X-Polarr-Offline-Cache") === "1",
    token,
  );
  return response;
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body === "string") return init.body;
  if (input instanceof Request) {
    try {
      return await input.clone().text();
    } catch {
      return "";
    }
  }
  return "";
}

function queuePlan(url: string, method: string, body: string): QueuePlan | null {
  let path: string;
  let data: Record<string, unknown>;
  try {
    path = new URL(url).pathname;
    data = body ? (JSON.parse(body) as Record<string, unknown>) : {};
  } catch {
    return null;
  }
  if (path === "/api/likes" && method === "POST") {
    if (typeof data.trackId !== "string" || typeof data.liked !== "boolean") return null;
    return { id: `like:${data.trackId}`, response: { ok: true, queued: true, offline: true, trackId: data.trackId, liked: data.liked } };
  }
  if (path === "/api/library/pins" && method === "POST") {
    if (typeof data.itemKey !== "string" || typeof data.pinned !== "boolean") return null;
    return { id: `pin:${data.itemKey}`, response: { ok: true, queued: true, offline: true, itemKey: data.itemKey, pinned: data.pinned } };
  }
  if (path === "/api/playlists" && method === "PATCH") {
    if (typeof data.playlistId !== "string") return null;
    return {
      id: `playlist:details:${data.playlistId}`,
      response: {
        queued: true,
        offline: true,
        playlist: { id: data.playlistId, name: data.name, description: data.description, isPrivate: data.isPrivate },
      },
    };
  }
  if (path === "/api/playlists" && method === "POST") {
    const action = typeof data.action === "string" ? data.action : "add";
    const allowed = new Set(["add", "remove", "rename", "delete", "move", "reorder", "moveTracks"]);
    if (!allowed.has(action) || typeof data.playlistId !== "string") return null;
    if (action === "add" && typeof data.trackId !== "string") return null;
    const subject = typeof data.trackId === "string" ? data.trackId : Array.isArray(data.trackIds) ? data.trackIds.join(",") : "playlist";
    const logicalAction = action === "add" || action === "remove" ? "membership" : action;
    return { id: `playlist:${logicalAction}:${data.playlistId}:${subject}`, response: { ok: true, queued: true, offline: true } };
  }
  if (path === "/api/notifications" && method === "POST" && data.action === "mark_read") {
    return { id: `notifications:read:${JSON.stringify(data.ids || "all")}`, response: { ok: true, queued: true, offline: true, unread: 0 } };
  }
  if (path === "/api/taste/exclude" && method === "POST" && typeof data.trackId === "string") {
    return { id: `taste:exclude:${data.trackId}`, response: { ok: true, queued: true, offline: true, excluded: true } };
  }
  return null;
}

async function queueMutation(plan: QueuePlan, scope: string, serverUrl: string, url: string, method: string, body: string, contentType: string) {
  const entry: QueuedMutation = {
    id: `${scope}:${serverUrl}:${plan.id}`,
    scope,
    serverUrl,
    url,
    method,
    body,
    contentType,
    createdAt: Date.now(),
    attempts: 0,
  };
  await putMutation(entry);
  await applyOptimisticMutation(scope, serverUrl, url, method, body);
  window.dispatchEvent(new CustomEvent("polarr-offline-change-queued", { detail: plan.response }));
  return new Response(JSON.stringify(plan.response), {
    status: 202,
    headers: { "Content-Type": "application/json", "X-Polarr-Offline-Queued": "1" },
  });
}

async function applyOptimisticMutation(scope: string, serverUrl: string, requestUrl: string, method: string, body: string) {
  let request: URL;
  let data: Record<string, unknown>;
  try {
    request = new URL(requestUrl);
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return;
  }
  await mutateStoredJson(`${scope}:${serverUrl}`, (key, value) => {
    const cachedUrlStart = key.indexOf("http");
    if (cachedUrlStart < 0) return null;
    const cached = new URL(key.slice(cachedUrlStart));

    if (request.pathname === "/api/likes" && cached.pathname === "/api/likes") {
      const trackId = String(data.trackId || "");
      const liked = data.liked === true;
      if (cached.searchParams.has("trackId")) {
        if (cached.searchParams.get("trackId") !== trackId) return null;
        return { ...value, trackId, liked };
      }
      const tracks = Array.isArray(value.tracks)
        ? (value.tracks as Record<string, unknown>[]).filter((track) => String(track.id || "") !== trackId)
        : [];
      if (liked) {
        tracks.unshift({
          id: trackId,
          title: data.title || "Unknown track",
          artist: data.artist || "Unknown artist",
          album: data.album || data.title || "",
          coverPath: data.coverPath || null,
          duration: data.duration || 0,
          path: "",
          source: "stream",
          streamOnly: true,
        });
      }
      return { ...value, tracks, count: tracks.length };
    }

    if (request.pathname === "/api/library/pins" && cached.pathname === "/api/library/pins") {
      const itemKey = String(data.itemKey || "");
      const pins = new Set(Array.isArray(value.pins) ? (value.pins as string[]) : []);
      if (data.pinned === true) pins.add(itemKey);
      else pins.delete(itemKey);
      return { ...value, pins: [...pins] };
    }

    if (request.pathname !== "/api/playlists" || cached.pathname !== "/api/playlists") return null;
    const playlistId = String(data.playlistId || "");
    const action = typeof data.action === "string" ? data.action : method === "PATCH" ? "details" : "add";
    if (cached.searchParams.get("id") === playlistId) {
      const playlist = value.playlist && typeof value.playlist === "object"
        ? { ...(value.playlist as Record<string, unknown>) }
        : null;
      if (playlist && (action === "rename" || action === "details")) {
        if (data.name !== undefined) playlist.name = data.name;
        if (data.description !== undefined) playlist.description = data.description;
        if (data.isPrivate !== undefined) playlist.isPrivate = data.isPrivate;
      }
      let tracks = Array.isArray(value.tracks) ? [...value.tracks] : [];
      if (action === "remove") tracks = tracks.filter((track) => String((track as Record<string, unknown>).id || "") !== data.trackId);
      if (action === "reorder" && Array.isArray(data.trackIds)) {
        const byId = new Map(tracks.map((track) => [String((track as Record<string, unknown>).id || ""), track]));
        tracks = data.trackIds.map((id) => byId.get(String(id))).filter(Boolean);
      }
      return { ...value, playlist, tracks };
    }
    if (!cached.search && Array.isArray(value.playlists)) {
      let playlists = value.playlists as Record<string, unknown>[];
      if (action === "delete") playlists = playlists.filter((playlist) => String(playlist.id || "") !== playlistId);
      if (action === "rename" || action === "details" || action === "move") {
        playlists = playlists.map((playlist) => {
          if (String(playlist.id || "") !== playlistId) return playlist;
          return {
            ...playlist,
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.isPrivate !== undefined ? { isPrivate: data.isPrivate } : {}),
            ...(action === "move" ? { folderId: data.folderId } : {}),
          };
        });
      }
      return { ...value, playlists };
    }
    return null;
  });
}

async function flushMutationQueue() {
  if (flushing || !navigator.onLine) return;
  const bridge = window.__POLARR_NATIVE_CLIENT__;
  const token = nativeSessionToken();
  if (!bridge || !token) return;
  flushing = true;
  const scope = credentialScope(token);
  try {
    const entries = await listMutations(scope, bridge.serverUrl);
    for (const entry of entries) {
      try {
        const headers = new Headers();
        headers.set("Authorization", `Bearer ${token}`);
        if (entry.contentType) headers.set("Content-Type", entry.contentType);
        const response = await serverFetch(entry.url, { method: entry.method, headers, body: entry.body || undefined });
        if (response.ok) {
          await deleteMutation(entry.id);
          window.dispatchEvent(new CustomEvent("polarr-offline-change-synced", { detail: { id: entry.id } }));
          continue;
        }
        if (response.status === 401) clearNativeSessionToken();
        if (response.status >= 400 && response.status < 500) {
          await deleteMutation(entry.id);
          window.dispatchEvent(new CustomEvent("polarr-offline-change-rejected", { detail: { id: entry.id, status: response.status } }));
          continue;
        }
        await updateMutationAttempts(entry);
        break;
      } catch {
        await updateMutationAttempts(entry);
        break;
      }
    }
  } catch {
    // IndexedDB may be unavailable in private browsing; retry on the next online event.
  } finally {
    flushing = false;
  }
}

async function refreshMediaTicket() {
  const bridge = window.__POLARR_NATIVE_CLIENT__;
  const token = nativeSessionToken();
  if (!bridge || !token) {
    if (bridge) {
      bridge.mediaTicket = null;
      bridge.mediaTicketExpiresAt = null;
    }
    return;
  }
  try {
    const response = await serverFetch(
      new URL("/api/v1/native/media-ticket", `${bridge.serverUrl}/`).toString(),
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    const data = response.ok ? await response.json() : null;
    const next = typeof data?.ticket === "string" ? data.ticket : null;
    const expiresAt = Number(data?.expiresAt);
    const changed = bridge.mediaTicket !== next;
    bridge.mediaTicket = next;
    bridge.mediaTicketExpiresAt = Number.isFinite(expiresAt) ? expiresAt : null;
    if (changed && next) {
      const { emitMediaTicketUpdated } = await import("../../src/lib/ui-events");
      emitMediaTicketUpdated();
    }
  } catch {
    bridge.mediaTicket = null;
    bridge.mediaTicketExpiresAt = null;
  }
}

async function warmOfflineLibrary() {
  if (warming || !navigator.onLine) return;
  const bridge = window.__POLARR_NATIVE_CLIENT__;
  const token = nativeSessionToken();
  if (!bridge || !token) return;
  const warmKey = `polarr_native_warm:${credentialScope(token)}:${bridge.serverUrl}`;
  const lastWarm = Number(localStorage.getItem(warmKey) || "0");
  if (Date.now() - lastWarm < 15 * 60 * 1000) return;
  warming = true;
  try {
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    let successful = 0;
    const paths = [
      "/api/auth/me",
      "/api/discover",
      "/api/library/nav",
      "/api/library",
      "/api/likes",
      "/api/playlists",
      "/api/recent?limit=100",
      "/api/profiles",
    ];
    await Promise.allSettled(
      paths.map(async (path) => {
        const url = new URL(path, `${bridge.serverUrl}/`).toString();
        const response = await serverFetch(url, { headers });
        if (response.ok) successful += 1;
        cacheResponse(url, token, response);
      }),
    );
    if (successful > 0) localStorage.setItem(warmKey, String(Date.now()));
  } finally {
    warming = false;
  }
}

function clearDesktopLayoutMarkers() {
  document.documentElement.classList.remove("polarr-desktop");
  document.documentElement.removeAttribute("data-polarr-desktop");
  delete document.documentElement.dataset.polarrDesktop;
  document.documentElement.removeAttribute("data-polarr-overlay-titlebar");
  delete document.documentElement.dataset.polarrOverlayTitlebar;
  try {
    sessionStorage.removeItem("polarr-desktop");
    sessionStorage.removeItem("polarr-desktop-overlay");
  } catch {
    /* private mode */
  }
  const hide = document.getElementById("polarr-desktop-hide-header");
  hide?.remove();
  try {
    const w = window as Window & { __POLARR_DESKTOP__?: Record<string, unknown> };
    // Drop a desktop global that was only stamped for offline downloads.
    if (w.__POLARR_DESKTOP__ && w.__POLARR_DESKTOP__.chrome !== true) {
      delete w.__POLARR_DESKTOP__;
    }
  } catch {
    /* ignore */
  }
}

export async function installNativeRuntime(serverUrl: string, platform: NativePlatform, version?: string, changeServer?: () => void | Promise<void>) {
  const normalized = serverUrl.replace(/\/+$/, "");
  const mobilePlatform = platform === "ios" ? detectIosMobilePlatform() : undefined;
  const desktopPlatform = platform === "desktop" ? detectNativeDesktopPlatform() : undefined;
  window.__POLARR_NATIVE_CLIENT__ = {
    serverUrl: normalized,
    platform,
    mobilePlatform,
    desktopPlatform,
    version,
    changeServer,
    mediaTicket: null,
    mediaTicketExpiresAt: null,
    refreshMediaTicket,
  };
  if (platform === "ios") {
    document.documentElement.classList.add("dark", "polarr-ios");
    document.documentElement.dataset.polarrNative = "ios";
    if (mobilePlatform) {
      document.documentElement.dataset.polarrMobile = mobilePlatform;
    }
    // Offline downloads must not flip the phone UI into desktop chrome.
    clearDesktopLayoutMarkers();
  } else {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.polarrNative = platform;
  }

  if (!installed) {
    installed = true;
    window.addEventListener("online", () => {
      void flushMutationQueue();
      void warmOfflineLibrary();
    });
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const bridge = window.__POLARR_NATIVE_CLIENT__;
      if (!bridge) return originalFetch(input, init);
      const rewritten = apiUrl(bridge.serverUrl, input);
      const url = typeof rewritten === "string" ? rewritten : rewritten instanceof URL ? rewritten.toString() : rewritten.url;
      const headers = new Headers(rewritten instanceof Request ? rewritten.headers : init?.headers);
      const token = nativeSessionToken();
      const scope = credentialScope(token);
      const sameServer = new URL(url).origin === new URL(bridge.serverUrl).origin;
      if (token && sameServer) headers.set("Authorization", `Bearer ${token}`);
      if (bridge.mobilePlatform && sameServer) {
        headers.set("x-polarr-mobile-platform", bridge.mobilePlatform);
      }
      if (bridge.desktopPlatform && sameServer) {
        headers.set("x-polarr-desktop-platform", bridge.desktopPlatform);
      }
      const method = (init?.method || (rewritten instanceof Request ? rewritten.method : "GET")).toUpperCase();
      const body = method === "GET" || method === "HEAD" ? "" : await requestBody(input, init);
      const plan = sameServer ? queuePlan(url, method, body) : null;

      if (method !== "GET" && method !== "HEAD" && navigator.onLine) await flushMutationQueue();
      try {
        // Spotify-style: paint from IndexedDB immediately, refresh in background.
        if (method === "GET" && sameServer && !shouldBypassCache(init, headers)) {
          const stale = await cachedResponse(url, token);
          if (stale) {
            const cachedAt = Number(stale.headers.get("X-Polarr-Cached-At") || "0");
            const ageMs = Date.now() - cachedAt;
            // Skip revalidate when fresh to avoid refresh→event→refetch loops.
            if (navigator.onLine && ageMs >= 30_000) {
              revalidateInBackground(url, token, init, headers, method, body);
            }
            return decorateJson(stale, token);
          }
        }
        const response = sameServer
          ? await serverFetch(url, { ...init, method, headers, body: body || undefined })
          : await originalFetch(rewritten, { ...init, headers });
        if (method === "GET") cacheResponse(url, token, response);
        if (response.status === 401 && token) clearNativeSessionToken();
        if (response.ok) void flushMutationQueue();
        return decorateJson(response, token);
      } catch (error) {
        if (method === "GET") {
          const cached = await cachedResponse(url, token);
          if (cached) return decorateJson(cached, token);
        }
        if (plan && token) {
          try {
            const queued = await queueMutation(plan, scope, bridge.serverUrl, url, method, body, headers.get("Content-Type") || "application/json");
            return decorateJson(queued, token);
          } catch {
            // Fall through to the original network error if persistence failed.
          }
        }
        throw error;
      }
    };
  }
  // Never hold the bundled interface behind a server request. The client must
  // paint immediately from local state when the server is slow or unavailable.
  void refreshMediaTicket();
  void flushMutationQueue();
  void warmOfflineLibrary();
}
