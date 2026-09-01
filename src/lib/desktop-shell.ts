/**
 * Polarr desktop (Tauri) shell detection + chrome bridge.
 * Content runs in a child Tauri webview (label "server"), not an iframe —
 * so parent.postMessage is unavailable. Prefer Tauri invoke/events; keep
 * postMessage as a fallback for older iframe shells.
 */

export const DESKTOP_CHROME_CHANNEL = "polarr-desktop-chrome";
/** Shell ← server (auth / ready). */
export const DESKTOP_CHROME_UP_EVENT = "polarr-desktop-chrome-up";
/** Shell → server (navigate / search / hello). */
export const DESKTOP_CHROME_DOWN_EVENT = "polarr-desktop-chrome-down";
export const DESKTOP_QUERY_PARAM = "desktop";
export const OVERLAY_TITLEBAR_QUERY_PARAM = "titlebar";
export const OVERLAY_TITLEBAR_QUERY_VALUE = "overlay";
const STORAGE_KEY = "polarr-desktop";
const OVERLAY_STORAGE_KEY = "polarr-desktop-overlay";
const HIDE_STYLE_ID = "polarr-desktop-hide-header";
const DESKTOP_PLATFORM_COOKIE = "polarr_desktop_platform";
const HIDE_CSS =
  "html[data-polarr-desktop]:not([data-polarr-overlay-titlebar]) [data-polarr-app-header]{display:none!important;height:0!important;max-height:0!important;min-height:0!important;overflow:hidden!important;border:0!important;padding:0!important;margin:0!important;visibility:hidden!important;pointer-events:none!important;opacity:0!important;position:absolute!important;clip:rect(0,0,0,0)!important;flex:0 0 0!important;}";

export type DesktopAuthPayload = {
  authenticated: boolean;
  username?: string | null;
  avatarUrl?: string | null;
  /** Base64 data URL — shell webview cannot send session cookies to avatar API. */
  avatarDataUrl?: string | null;
  isStaff?: boolean;
  pathname?: string;
  searchQuery?: string | null;
  notificationUnread?: number;
};

export type DesktopChromeToShell =
  | { channel: typeof DESKTOP_CHROME_CHANNEL; type: "ready" }
  | { channel: typeof DESKTOP_CHROME_CHANNEL; type: "auth"; payload: DesktopAuthPayload }
  | {
      channel: typeof DESKTOP_CHROME_CHANNEL;
      type: "pong" | "ack";
      id: string;
      ok?: boolean;
    };

export type DesktopChromeFromShell =
  | { channel: typeof DESKTOP_CHROME_CHANNEL; type: "ping"; id: string }
  | {
      channel: typeof DESKTOP_CHROME_CHANNEL;
      type: "navigate";
      id?: string;
      path: string;
    }
  | {
      channel: typeof DESKTOP_CHROME_CHANNEL;
      type: "search";
      id?: string;
      q: string;
    }
  | { channel: typeof DESKTOP_CHROME_CHANNEL; type: "logout"; id?: string }
  | { channel: typeof DESKTOP_CHROME_CHANNEL; type: "hello" }
  | {
      channel: typeof DESKTOP_CHROME_CHANNEL;
      type: "open-notifications";
      id?: string;
    }
  | {
      channel: typeof DESKTOP_CHROME_CHANNEL;
      type: "open-profile";
      id?: string;
    };

type TauriEventApi = {
  emit: (event: string, payload?: unknown) => Promise<void>;
  listen: (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => Promise<() => void>;
};

type TauriInvoke = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

function getTauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  const invoke =
    w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null;
  return typeof invoke === "function" ? invoke.bind(w.__TAURI__?.core ?? w) : null;
}

function getTauriEventApi(): TauriEventApi | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    __TAURI__?: { event?: TauriEventApi };
    __TAURI_INTERNALS__?: { transformCallback?: unknown };
  };
  const api = w.__TAURI__?.event;
  if (api && typeof api.emit === "function" && typeof api.listen === "function") {
    return api;
  }
  return null;
}

export function hasPolarrDesktopGlobal(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & { __POLARR_DESKTOP__?: Record<string, unknown> };
  return Boolean(w.__POLARR_DESKTOP__);
}

function applyOverlayTitlebarAttr(on: boolean) {
  if (on) {
    document.documentElement.dataset.polarrOverlayTitlebar = "1";
    document.documentElement.setAttribute("data-polarr-overlay-titlebar", "1");
  } else {
    delete document.documentElement.dataset.polarrOverlayTitlebar;
    document.documentElement.removeAttribute("data-polarr-overlay-titlebar");
  }
}

export function isOverlayTitlebar(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.dataset.polarrOverlayTitlebar === "1") return true;
  if (
    document.documentElement.getAttribute("data-polarr-overlay-titlebar") === "1"
  ) {
    return true;
  }
  try {
    if (sessionStorage.getItem(OVERLAY_STORAGE_KEY) === "1") return true;
  } catch {
    /* ignore */
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(OVERLAY_TITLEBAR_QUERY_PARAM) === OVERLAY_TITLEBAR_QUERY_VALUE) {
      return true;
    }
  } catch {
    /* ignore */
  }
  // macOS desktop loads the server in the main webview under native traffic
  // lights, so the web header is the title bar.
  try {
    if (
      isPolarrDesktop() &&
      /Macintosh|Mac OS X/i.test(navigator.userAgent) &&
      !/iPhone|iPad|iPod/i.test(navigator.userAgent)
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function markPolarrDesktop(): void {
  if (typeof window === "undefined") return;
  try {
    const agent = navigator.userAgent;
    const platform = /Windows/i.test(agent)
      ? "windows"
      : /Macintosh|Mac OS X/i.test(agent)
        ? "macos"
        : /Linux/i.test(agent)
          ? "linux"
          : "desktop";
    document.cookie = `${DESKTOP_PLATFORM_COOKIE}=${platform}; Path=/; SameSite=Lax`;
  } catch {
    /* notification display hint only */
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* private mode */
  }
  document.documentElement.dataset.polarrDesktop = "1";
  document.documentElement.setAttribute("data-polarr-desktop", "1");

  const overlay = isOverlayTitlebar();
  if (overlay) {
    try {
      sessionStorage.setItem(OVERLAY_STORAGE_KEY, "1");
    } catch {
      /* private mode */
    }
  }
  applyOverlayTitlebarAttr(overlay);

  let style = document.getElementById(HIDE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = HIDE_STYLE_ID;
    style.textContent = HIDE_CSS;
    (document.body || document.head || document.documentElement).appendChild(
      style,
    );
  } else {
    style.textContent = HIDE_CSS;
  }

  // Ensure the global exists even if the Tauri init script lost the race.
  const w = window as Window & { __POLARR_DESKTOP__?: Record<string, unknown> };
  if (!w.__POLARR_DESKTOP__) {
    try {
      w.__POLARR_DESKTOP__ = {
        version: "0.2.0",
        offline: true,
        discordRpc: true,
        chrome: true,
      };
    } catch {
      /* ignore */
    }
  }
}

export function isPolarrDesktop(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.dataset.polarrDesktop === "1") return true;
  if (
    document.documentElement.getAttribute("data-polarr-desktop") === "1"
  ) {
    return true;
  }
  if (hasPolarrDesktopGlobal()) return true;
  try {
    if (sessionStorage.getItem(STORAGE_KEY) === "1") return true;
  } catch {
    /* ignore */
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(DESKTOP_QUERY_PARAM) === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Capture desktop flags into sessionStorage and strip them from the visible URL. */
export function captureDesktopQueryParam(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    const desktop = url.searchParams.get(DESKTOP_QUERY_PARAM) === "1";
    const overlay =
      url.searchParams.get(OVERLAY_TITLEBAR_QUERY_PARAM) ===
      OVERLAY_TITLEBAR_QUERY_VALUE;
    if (!desktop && !overlay) return false;
    if (overlay) {
      try {
        sessionStorage.setItem(OVERLAY_STORAGE_KEY, "1");
      } catch {
        /* private mode */
      }
      applyOverlayTitlebarAttr(true);
    }
    if (desktop || overlay) markPolarrDesktop();
    url.searchParams.delete(DESKTOP_QUERY_PARAM);
    url.searchParams.delete(OVERLAY_TITLEBAR_QUERY_PARAM);
    url.searchParams.delete("desktop-version");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", next);
    return true;
  } catch {
    return false;
  }
}

export function postChromeToShell(message: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const payload = { ...message, channel: DESKTOP_CHROME_CHANNEL };

  // Prefer invoke — reliable on remote child webviews (event.emit often is not).
  const invoke = getTauriInvoke();
  if (invoke) {
    void invoke("desktop_chrome_up", { message: payload }).catch(() => null);
  }

  const tauri = getTauriEventApi();
  if (tauri) {
    void tauri.emit(DESKTOP_CHROME_UP_EVENT, payload).catch(() => null);
  }

  // Legacy iframe shell.
  if (window.parent !== window) {
    try {
      window.parent.postMessage(payload, "*");
    } catch {
      /* ignore */
    }
  }
}

/** Subscribe to commands from the Tauri title bar. Returns unsubscribe. */
export function listenChromeFromShell(
  handler: (data: DesktopChromeFromShell) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const deliver = (raw: unknown) => {
    const data = raw as DesktopChromeFromShell | null;
    if (!data || data.channel !== DESKTOP_CHROME_CHANNEL) return;
    handler(data);
  };

  const onWindowMessage = (event: MessageEvent) => {
    deliver(event.data);
  };
  window.addEventListener("message", onWindowMessage);

  // Rust-forwarded CustomEvent (works when event.listen is unavailable).
  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    deliver(detail);
  };
  window.addEventListener("polarr-chrome-down", onCustom);
  window.addEventListener("polarr-desktop-chrome-message", onCustom);

  let unlistenTauri: (() => void) | null = null;
  const tauri = getTauriEventApi();
  if (tauri) {
    void tauri
      .listen(DESKTOP_CHROME_DOWN_EVENT, (event) => {
        deliver(event.payload);
      })
      .then((un) => {
        unlistenTauri = un;
      })
      .catch(() => null);
  }

  return () => {
    window.removeEventListener("message", onWindowMessage);
    window.removeEventListener("polarr-chrome-down", onCustom);
    window.removeEventListener("polarr-desktop-chrome-message", onCustom);
    unlistenTauri?.();
  };
}

export function absolutizeUrl(url: string | null | undefined, origin: string): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${origin.replace(/\/$/, "")}${path}`;
}
