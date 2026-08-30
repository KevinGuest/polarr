import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
import { getAppVersion } from "./updater";

const appWindow = getCurrentWindow();
const app = document.querySelector<HTMLDivElement>("#app")!;

const CHROME_CHANNEL = "polarr-desktop-chrome";
const CHROME_UP_EVENT = "polarr-desktop-chrome-up";
const CHROME_DOWN_EVENT = "polarr-desktop-chrome-down";

function isMacPlatform(): boolean {
  return (
    /Macintosh|Mac OS X/i.test(navigator.userAgent) &&
    !/iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

type AuthState = {
  authenticated: boolean;
  username: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
  isStaff: boolean;
  pathname: string | null;
  notificationUnread: number;
};

let authState: AuthState = {
  authenticated: false,
  username: null,
  avatarUrl: null,
  avatarDataUrl: null,
  isStaff: false,
  pathname: null,
  notificationUnread: 0,
};

let serverOpen = false;

if (isMacPlatform()) {
  document.documentElement.classList.add("mac");
}

app.innerHTML = `
  <div class="app-frame">
    <header class="titlebar" id="titlebar">
      <div class="titlebar-drag" data-tauri-drag-region aria-hidden="true"></div>
      <div class="mac-traffic" id="mac-traffic" aria-label="Window">
        <button type="button" class="traffic-btn traffic-close" id="mac-close" title="Close" aria-label="Close">
          <svg class="traffic-glyph" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3l6 6M9 3 3 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
        <button type="button" class="traffic-btn traffic-min" id="mac-min" title="Minimize" aria-label="Minimize">
          <svg class="traffic-glyph" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 6h7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
        <button type="button" class="traffic-btn traffic-zoom" id="mac-zoom" title="Maximize" aria-label="Maximize">
          <svg class="traffic-glyph" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.8 6h6.4M6 2.8v6.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div class="menu-wrap">
        <button type="button" class="tb-btn" id="menu-btn" title="Menu" aria-label="Menu" aria-haspopup="menu" aria-expanded="false">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="3" cy="8" r="1.35" fill="currentColor"/>
            <circle cx="8" cy="8" r="1.35" fill="currentColor"/>
            <circle cx="13" cy="8" r="1.35" fill="currentColor"/>
          </svg>
        </button>
      </div>
      <div class="titlebar-nav">
        <button type="button" class="tb-btn" id="nav-back" title="Back" aria-label="Back">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M10.2 2.6 4.8 8l5.4 5.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button type="button" class="tb-btn" id="nav-forward" title="Forward" aria-label="Forward">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M5.8 2.6 11.2 8 5.8 13.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <div class="titlebar-center" id="titlebar-center">
        <div class="titlebar-brand-search">
          <button type="button" class="titlebar-brand-btn" id="titlebar-brand-btn" aria-label="Home" hidden>
            <img class="titlebar-brand" id="titlebar-brand" src="/polarr-icon.png" alt="" width="32" height="32" />
          </button>
          <div class="titlebar-search" id="titlebar-search" hidden>
            <div class="titlebar-search-idle" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="7"/>
                <path d="m20 20-3.5-3.5"/>
              </svg>
              <span>Search</span>
            </div>
            <svg class="titlebar-search-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7"/>
              <path d="m20 20-3.5-3.5"/>
            </svg>
            <input
              id="chrome-search"
              type="search"
              name="polarr-desktop-search"
              placeholder="Search"
              aria-label="Search"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
        </div>
      </div>

      <div class="titlebar-right">
        <button type="button" class="tb-btn alerts-btn" id="alerts-btn" hidden title="Notifications" aria-label="Notifications">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
          </svg>
          <span class="alerts-badge" id="alerts-badge" hidden>0</span>
        </button>
        <div class="profile-wrap">
          <button type="button" class="profile-btn" id="profile-btn" hidden title="Account" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false">
            <span id="profile-initial">?</span>
          </button>
        </div>
      </div>
      <div class="win-controls">
        <button type="button" class="win-btn" id="win-min" title="Minimize" aria-label="Minimize">
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M2.5 6h7" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
          </svg>
        </button>
        <button type="button" class="win-btn" id="win-max" title="Maximize" aria-label="Maximize">
          <svg class="icon-max" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/>
          </svg>
          <svg class="icon-restore" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" hidden>
            <path d="M4.5 4.5h5v5h-5z" fill="none" stroke="currentColor" stroke-width="1"/>
            <path d="M2.5 7.5V2.5H7.5" fill="none" stroke="currentColor" stroke-width="1"/>
          </svg>
        </button>
        <button type="button" class="win-btn win-close" id="win-close" title="Close" aria-label="Close">
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M3 3l6 6M9 3 3 9" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </header>

    <main class="content" id="content">
      <div class="setup" id="setup-view">
        <div class="setup-inner">
          <img class="logo" src="/polarr-icon.png" alt="" width="72" height="72" />
          <h1>Polarr</h1>
          <form id="server-form" autocomplete="on" novalidate>
            <div class="field-group">
              <input
                id="server-url"
                name="serverUrl"
                type="text"
                inputmode="url"
                placeholder="Server URL"
                aria-label="Server URL"
                required
                spellcheck="false"
                autocapitalize="off"
                autocorrect="off"
              />
            </div>
            <button type="submit" id="connect">
              <span class="connect-spinner" aria-hidden="true" hidden></span>
              <span id="connect-label">Connect</span>
            </button>
          </form>
        </div>
      </div>
    </main>
    <div id="toast" class="toast" hidden role="status">
      <svg class="toast-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <path d="M10 9.2v4.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        <circle cx="10" cy="6.6" r="0.9" fill="currentColor"/>
      </svg>
      <span id="toast-text"></span>
    </div>
  </div>
`;

(window as unknown as { __POLARR_DESKTOP__?: Record<string, unknown> }).__POLARR_DESKTOP__ = {
  version: "0.2.0",
  offline: true,
  discordRpc: true,
  chrome: true,
};

const setupView = document.querySelector<HTMLDivElement>("#setup-view")!;
const form = document.querySelector<HTMLFormElement>("#server-form")!;
const input = document.querySelector<HTMLInputElement>("#server-url")!;
const toastEl = document.querySelector<HTMLDivElement>("#toast")!;
const toastText = document.querySelector<HTMLSpanElement>("#toast-text")!;
const button = document.querySelector<HTMLButtonElement>("#connect")!;
const buttonLabel = document.querySelector<HTMLSpanElement>("#connect-label")!;
const buttonSpinner = button.querySelector<HTMLSpanElement>(".connect-spinner")!;
const titlebar = document.querySelector<HTMLElement>("#titlebar")!;
const menuBtn = document.querySelector<HTMLButtonElement>("#menu-btn")!;
const maxBtn = document.querySelector<HTMLButtonElement>("#win-max")!;
const iconMax = maxBtn.querySelector<SVGElement>(".icon-max")!;
const iconRestore = maxBtn.querySelector<SVGElement>(".icon-restore")!;
const appFrame = document.querySelector<HTMLDivElement>(".app-frame")!;
const titlebarBrandBtn = document.querySelector<HTMLButtonElement>(
  "#titlebar-brand-btn",
)!;
const searchWrap = document.querySelector<HTMLDivElement>("#titlebar-search")!;
const searchInput = document.querySelector<HTMLInputElement>("#chrome-search")!;
const alertsBtn = document.querySelector<HTMLButtonElement>("#alerts-btn")!;
const alertsBadge = document.querySelector<HTMLSpanElement>("#alerts-badge")!;
const profileBtn = document.querySelector<HTMLButtonElement>("#profile-btn")!;
const profileInitial = document.querySelector<HTMLSpanElement>("#profile-initial")!;

function isInteractiveTitlebarTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button, input, a, label, .menu-wrap, .profile-wrap, .titlebar-search, .titlebar-brand-btn, .mac-traffic, .win-controls, .titlebar-nav",
    ),
  );
}

let profileAvatarFailedSrc: string | null = null;

function showProfileInitials(name: string) {
  profileBtn.classList.remove("is-avatar-loading");
  const existingImg = profileBtn.querySelector("img");
  existingImg?.remove();
  profileInitial.hidden = false;
  profileInitial.textContent = (name.trim()[0] || "?").toUpperCase();
}

function applyProfileAvatar(name: string) {
  // Shell origin cannot auth-fetch server avatar URLs — only embedded data URLs work.
  const src = authState.avatarDataUrl;
  if (!src || profileAvatarFailedSrc === src) {
    showProfileInitials(name);
    return;
  }

  let img = profileBtn.querySelector("img");
  if (!img) {
    profileInitial.hidden = true;
    profileBtn.classList.add("is-avatar-loading");
    img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.addEventListener(
      "load",
      () => {
        profileBtn.classList.remove("is-avatar-loading");
      },
      { once: true },
    );
    img.addEventListener(
      "error",
      () => {
        profileAvatarFailedSrc = src;
        showProfileInitials(name);
      },
      { once: true },
    );
    profileBtn.prepend(img);
  }

  if (img.src !== src) {
    profileBtn.classList.add("is-avatar-loading");
    img.src = src;
  }
}

let toastTimer: number | null = null;
function setConnectButton(label: string, busy: boolean) {
  button.disabled = busy;
  buttonLabel.textContent = label;
  buttonSpinner.hidden = !busy;
  button.toggleAttribute("aria-busy", busy);
}

function showToast(message: string) {
  toastText.textContent = message;
  toastEl.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
    toastTimer = null;
  }, 4200);
}

type ChromeMenuItem =
  | { kind: "label"; text: string }
  | { kind: "separator" }
  | { kind: "action"; id: string; text: string; danger?: boolean };

const MENU_WINDOW_LABEL = "chrome-menu";
/** Transparent inset so CSS shadow isn't clipped; OS shadow stays off (Win draws a 1px frame). */
const MENU_SHADOW_PAD = 14;
const MENU_WIDTH = 192;
const isMac = isMacPlatform();
/** Which titlebar control owns the open (or just-closed) menu — used for click-to-toggle. */
let menuAnchorEl: HTMLElement | null = null;
let menuClosedAt = 0;

function estimateMenuHeight(items: ChromeMenuItem[]): number {
  let h = 8; // .menu padding
  for (const item of items) {
    if (item.kind === "label") h += 28;
    else if (item.kind === "separator") h += 9;
    else h += 36;
  }
  return Math.max(h, 48);
}

async function closeChromeMenu() {
  const existing = await WebviewWindow.getByLabel(MENU_WINDOW_LABEL);
  if (existing) {
    try {
      await existing.close();
    } catch {
      /* ignore */
    }
  }
  menuClosedAt = Date.now();
}

async function openNativeChromeMenu(
  anchor: HTMLElement,
  items: ChromeMenuItem[],
) {
  const built = [];
  for (const item of items) {
    if (item.kind === "separator") {
      built.push(await PredefinedMenuItem.new({ item: "Separator" }));
      continue;
    }
    if (item.kind === "label") {
      built.push(await MenuItem.new({ text: item.text, enabled: false }));
      continue;
    }
    const id = item.id;
    built.push(
      await MenuItem.new({
        id,
        text: item.text,
        action: () => {
          void emit("polarr-chrome-menu-action", { id });
        },
      }),
    );
  }
  const menu = await Menu.new({ items: built });
  const rect = anchor.getBoundingClientRect();
  await menu.popup(new LogicalPosition(rect.left, rect.bottom + 4));
}

async function openChromeMenu(
  anchor: HTMLElement,
  items: ChromeMenuItem[],
  align: "start" | "end",
) {
  if (isMac) {
    menuAnchorEl = anchor;
    try {
      await openNativeChromeMenu(anchor, items);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Menu failed to open");
    }
    return;
  }

  await closeChromeMenu();
  menuAnchorEl = anchor;

  const rect = anchor.getBoundingClientRect();
  const scale = await appWindow.scaleFactor();
  const outer = await appWindow.outerPosition();
  const logicalOuter = outer.toLogical(scale);
  const pad = isMac ? 0 : MENU_SHADOW_PAD;
  const height = estimateMenuHeight(items) + pad * 2;
  const width = MENU_WIDTH + pad * 2;
  const x =
    align === "end"
      ? logicalOuter.x + rect.right - MENU_WIDTH - pad
      : logicalOuter.x + rect.left - pad;
  const y = logicalOuter.y + rect.bottom + 6 - pad;

  let payloadSent = false;
  const sendPayload = () => {
    if (payloadSent) return;
    payloadSent = true;
    void emit("polarr-chrome-menu-open", { items });
  };

  const unlistenReady = await listen("polarr-chrome-menu-ready", () => {
    sendPayload();
  });

  const menuWin = new WebviewWindow(MENU_WINDOW_LABEL, {
    url: "chrome-menu.html",
    title: "Menu",
    width,
    height,
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    resizable: false,
    decorations: false,
    // WKWebView paints transparent windows white on macOS.
    transparent: !isMac,
    // On Windows, shadow:true forces a 1px white/DWM frame on undecorated windows.
    shadow: isMac,
    alwaysOnTop: true,
    skipTaskbar: true,
    focus: true,
    visible: true,
    theme: "dark",
    backgroundColor: isMac ? "#09090b" : "#00000000",
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(
        () => reject(new Error("menu create timeout")),
        4000,
      );
      void menuWin.once("tauri://created", () => {
        window.clearTimeout(t);
        resolve();
      });
      void menuWin.once("tauri://error", (e) => {
        window.clearTimeout(t);
        reject(e);
      });
    });
  } catch {
    unlistenReady();
    menuAnchorEl = null;
    return;
  }

  void menuWin.once("tauri://destroyed", () => {
    menuClosedAt = Date.now();
  });

  try {
    await menuWin.setShadow(false);
  } catch {
    /* ignore */
  }

  // Fallback if ready event already fired before we subscribed.
  window.setTimeout(() => {
    sendPayload();
    unlistenReady();
  }, 120);
}

/** Open menu, or close it if this control already owns the open/just-closed menu. */
async function toggleChromeMenu(
  anchor: HTMLElement,
  items: ChromeMenuItem[],
  align: "start" | "end",
) {
  if (isMac) {
    await openChromeMenu(anchor, items, align);
    return;
  }

  const existing = await WebviewWindow.getByLabel(MENU_WINDOW_LABEL);
  const justClosedSame =
    !existing &&
    menuAnchorEl === anchor &&
    Date.now() - menuClosedAt < 320;

  if ((existing && menuAnchorEl === anchor) || justClosedSame) {
    await closeChromeMenu();
    menuAnchorEl = null;
    return;
  }

  await openChromeMenu(anchor, items, align);
}

const UPDATER_WINDOW_LABEL = "updater";

async function revealMainWindow() {
  try {
    await appWindow.show();
    await appWindow.setFocus();
  } catch {
    /* ignore */
  }
}

function setServerOpenClass(open: boolean) {
  document.documentElement.classList.toggle("server-open", open);
}

function openUpdaterWindow(): Promise<void> {
  // Dev builds have no updater artifacts; skip the window entirely.
  if (import.meta.env.DEV) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    void (async () => {
      try {
        const existing = await WebviewWindow.getByLabel(UPDATER_WINDOW_LABEL);
        if (existing) {
          void existing.once("tauri://destroyed", finish);
          return;
        }
      } catch {
        finish();
        return;
      }

      const updaterWin = new WebviewWindow(UPDATER_WINDOW_LABEL, {
        url: "updater.html",
        title: "Polarr Update",
        width: 360,
        height: 132,
        center: true,
        resizable: false,
        decorations: false,
        transparent: false,
        shadow: isMac,
        alwaysOnTop: true,
        skipTaskbar: true,
        focus: true,
        visible: false,
        theme: "dark",
        backgroundColor: "#09090b",
      });

      void updaterWin.once("tauri://destroyed", finish);
      void updaterWin.once("tauri://error", finish);

      try {
        await updaterWin.setShadow(isMac);
      } catch {
        /* ignore */
      }
    })();
  });
}

async function changeServer() {
  try {
    await invoke("discord_clear_presence");
  } catch {
    // Best-effort.
  }
  try {
    await invoke("clear_server_url");
  } catch {
    // Still return to setup UI.
  }
  await showSetup(input.value);
}

async function openAppMenu(anchor: HTMLElement) {
  const version = await getAppVersion();
  const items: ChromeMenuItem[] = [
    { kind: "label", text: `Polarr ${version}` },
    { kind: "separator" },
    { kind: "action", id: "change-server", text: "Change Server…" },
    { kind: "separator" },
    { kind: "action", id: "quit", text: "Quit Polarr", danger: true },
  ];
  await toggleChromeMenu(anchor, items, isMac ? "end" : "start");
}

async function openAccountMenu(anchor: HTMLElement) {
  const name = authState.username || "Account";
  const items: ChromeMenuItem[] = [
    { kind: "label", text: name },
    { kind: "separator" },
    { kind: "action", id: "profile", text: "Profile" },
    { kind: "action", id: "settings", text: "Settings" },
  ];
  if (authState.isStaff) {
    items.push({ kind: "action", id: "admin", text: "Admin" });
  }
  items.push(
    { kind: "separator" },
    { kind: "action", id: "logout", text: "Logout", danger: true },
  );
  await toggleChromeMenu(anchor, items, "end");
}

/** Append ?desktop=1 so the web app can hide its duplicate header. */
function withDesktopParam(serverUrl: string): string {
  try {
    const u = new URL(serverUrl);
    u.searchParams.set("desktop", "1");
    return u.toString();
  } catch {
    const base = serverUrl.replace(/\/$/, "");
    return `${base}${serverUrl.includes("?") ? "&" : "?"}desktop=1`;
  }
}

function postToServer(message: Record<string, unknown>) {
  void emit(CHROME_DOWN_EVENT, { channel: CHROME_CHANNEL, ...message }).catch(
    () => null,
  );
}

function sayHelloToServer() {
  postToServer({ type: "hello" });
}

function setChromeAuthenticated(active: boolean) {
  searchWrap.hidden = !active;
  titlebarBrandBtn.hidden = !active;
  profileBtn.hidden = !active;
  alertsBtn.hidden = !active;
  if (!active) {
    searchInput.value = "";
    searchWrap.classList.remove("is-active");
    alertsBadge.hidden = true;
  }
}

function isAuthRoute(path: string): boolean {
  return (
    path === "/login" ||
    path === "/setup" ||
    path === "/join" ||
    path === "/forgot-password" ||
    path === "/reset-password" ||
    path.startsWith("/reset-password")
  );
}

function applyAuthState(
  next: Partial<AuthState> & { authenticated: boolean },
) {
  const incomingAvatarUrl =
    next.avatarUrl && !next.avatarUrl.includes("polarr-icon")
      ? next.avatarUrl
      : next.avatarUrl === null
        ? null
        : authState.avatarUrl;

  const incomingAvatarDataUrl =
    typeof next.avatarDataUrl === "string" && next.avatarDataUrl.length > 0
      ? next.avatarDataUrl
      : authState.avatarDataUrl;

  if (!next.authenticated) {
    authState = {
      authenticated: false,
      username: null,
      avatarUrl: null,
      avatarDataUrl: null,
      isStaff: false,
      pathname: next.pathname ?? authState.pathname,
      notificationUnread: 0,
    };
    profileAvatarFailedSrc = null;
    const path = authState.pathname || "";
    const authRoute = isAuthRoute(path);
    const showChrome =
      serverOpen && setupView.hidden && authState.authenticated && !authRoute;
    setChromeAuthenticated(showChrome);
    return;
  }

  if (
    incomingAvatarDataUrl &&
    incomingAvatarDataUrl !== authState.avatarDataUrl
  ) {
    profileAvatarFailedSrc = null;
  }

  authState = {
    authenticated: true,
    username: next.username ?? null,
    avatarUrl: incomingAvatarUrl,
    avatarDataUrl: incomingAvatarDataUrl,
    isStaff: Boolean(next.isStaff),
    pathname: next.pathname ?? authState.pathname,
    notificationUnread:
      typeof next.notificationUnread === "number"
        ? next.notificationUnread
        : authState.notificationUnread,
  };

  const path = authState.pathname || "";
  const authRoute = isAuthRoute(path);

  // Setup visible → chrome minimal. Server open + signed-in → search/alerts/profile.
  const showChrome =
    serverOpen && setupView.hidden && authState.authenticated && !authRoute;

  setChromeAuthenticated(showChrome);
  if (!showChrome) return;

  const name = authState.username || "Account";
  profileBtn.title = name;
  profileBtn.setAttribute("aria-label", `Account menu for ${name}`);

  const unread = authState.notificationUnread;
  if (unread > 0) {
    alertsBadge.hidden = false;
    alertsBadge.textContent = unread > 9 ? "9+" : String(unread);
    alertsBtn.setAttribute(
      "aria-label",
      `Notifications, ${unread} unread`,
    );
  } else {
    alertsBadge.hidden = true;
    alertsBtn.setAttribute("aria-label", "Notifications");
  }

  applyProfileAvatar(name);
}

/** Infer chrome from server webview URL — works without web DesktopChromeBridge. */
async function syncChromeFromWebviewUrl() {
  if (!serverOpen || !setupView.hidden) return;
  try {
    const href = await invoke<string | null>("get_server_webview_href");
    if (!href) return;
    let path = "/";
    try {
      path = new URL(href).pathname || "/";
    } catch {
      return;
    }
    const authRoute = isAuthRoute(path);
    // Don't invent auth from the URL when the bridge already told us we're signed in —
    // path-only polling was flipping chrome and causing title-bar blink.
    if (authState.authenticated && !authRoute) {
      if (authState.pathname !== path) {
        authState = { ...authState, pathname: path };
      }
      return;
    }
    applyAuthState({
      authenticated: !authRoute && authState.authenticated,
      pathname: path,
      username: authState.username,
      avatarUrl: authState.avatarUrl,
      avatarDataUrl: authState.avatarDataUrl,
      isStaff: authState.isStaff,
      notificationUnread: authState.notificationUnread,
    });
  } catch {
    /* ignore */
  }
}

let chromeUrlPoll: number | null = null;

function startChromeUrlPoll() {
  stopChromeUrlPoll();
  void syncChromeFromWebviewUrl();
  chromeUrlPoll = window.setInterval(() => {
    void syncChromeFromWebviewUrl();
  }, 4000);
}

function stopChromeUrlPoll() {
  if (chromeUrlPoll != null) {
    window.clearInterval(chromeUrlPoll);
    chromeUrlPoll = null;
  }
}

async function showSetup(prefill?: string) {
  serverOpen = false;
  setServerOpenClass(false);
  stopChromeUrlPoll();
  setupView.hidden = false;
  if (prefill) input.value = prefill;
  setConnectButton("Connect", false);
  authState = {
    authenticated: false,
    username: null,
    avatarUrl: null,
    avatarDataUrl: null,
    isStaff: false,
    pathname: null,
    notificationUnread: 0,
  };
  profileAvatarFailedSrc = null;
  setChromeAuthenticated(false);
  try {
    await invoke("close_server_webview");
  } catch {
    try {
      await invoke("hide_server_webview");
    } catch {
      /* ignore */
    }
  }
}

async function showServer(url: string) {
  setChromeAuthenticated(false);
  const target = withDesktopParam(url);
  try {
    await invoke("open_server_webview", { url: target });
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err));
    serverOpen = false;
    setupView.hidden = false;
    setServerOpenClass(false);
    setConnectButton("Connect", false);
    return;
  }
  // Do not remove the only visible/recoverable UI until native child-webview
  // creation succeeds. The child covers this area once it is ready.
  setupView.hidden = true;
  setServerOpenClass(true);
  serverOpen = true;
  startChromeUrlPoll();
  // Announce until the content bridge answers with auth.
  window.setTimeout(sayHelloToServer, 80);
  window.setTimeout(sayHelloToServer, 400);
  window.setTimeout(sayHelloToServer, 1200);
  window.setTimeout(() => void syncChromeFromWebviewUrl(), 200);
  window.setTimeout(() => void syncChromeFromWebviewUrl(), 800);
}

async function syncMaximizedUi() {
  try {
    const maximized = await appWindow.isMaximized();
    appFrame.classList.toggle("is-maximized", maximized);
    iconMax.toggleAttribute("hidden", maximized);
    iconRestore.toggleAttribute("hidden", !maximized);
    maxBtn.title = maximized ? "Restore" : "Maximize";
    maxBtn.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
  } catch {
    // Plain vite preview outside Tauri.
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const raw = input.value.trim();
  if (!raw) {
    showToast("URL not valid");
    return;
  }

  setConnectButton("Checking…", true);
  try {
    const url = await invoke<string>("probe_server_url", { url: raw });
    await invoke<string>("set_server_url", { url });
    setConnectButton("Connecting…", true);
    await showServer(url);
  } catch {
    showToast("URL not valid");
    setConnectButton("Connect", false);
  }
});

function bindWindowButton(
  selector: string,
  handler: (event: Event) => void,
) {
  document.querySelectorAll(selector).forEach((el) => {
    el.addEventListener("click", handler);
  });
}

bindWindowButton("#win-min, #mac-min", () => {
  void appWindow.minimize();
});

bindWindowButton("#win-max, #mac-zoom", () => {
  void appWindow.toggleMaximize().then(syncMaximizedUi);
});

bindWindowButton("#win-close, #mac-close", () => {
  void invoke("discord_clear_presence").catch(() => null);
  void appWindow.close();
});

void appWindow.onFocusChanged(({ payload: focused }) => {
  document.documentElement.classList.toggle("is-blurred", !focused);
});

void listen(CHROME_UP_EVENT, (event) => {
  const data = event.payload as {
    channel?: string;
    type?: string;
    payload?: {
      authenticated?: boolean;
      username?: string | null;
      avatarUrl?: string | null;
      avatarDataUrl?: string | null;
      isStaff?: boolean;
      pathname?: string;
      searchQuery?: string | null;
      notificationUnread?: number;
    };
  } | null;

  if (!data || data.channel !== CHROME_CHANNEL) return;

  if (data.type === "ready") {
    sayHelloToServer();
    return;
  }

  if (data.type === "auth" && data.payload) {
    const p = data.payload;
    applyAuthState({
      authenticated: Boolean(p.authenticated),
      username: p.username ?? null,
      avatarUrl: p.avatarUrl !== undefined ? p.avatarUrl : authState.avatarUrl,
      avatarDataUrl:
        p.avatarDataUrl !== undefined
          ? p.avatarDataUrl
          : authState.avatarDataUrl,
      isStaff: Boolean(p.isStaff),
      pathname: p.pathname ?? null,
      notificationUnread: p.notificationUnread ?? 0,
    });
    const sq = data.payload.searchQuery;
    if (document.activeElement !== searchInput) {
      if (typeof sq === "string") {
        searchInput.value = sq;
      } else if (sq === null) {
        searchInput.value = "";
      }
      syncSearchActive();
    }
  }
});

document.querySelectorAll(".titlebar-drag").forEach((el) => {
  el.addEventListener("dblclick", () => {
    void appWindow.toggleMaximize().then(syncMaximizedUi);
  });
});

// Prefer data-tauri-drag-region only — startDragging() on every mousedown flashes WebView2.
titlebar.addEventListener("dblclick", (event) => {
  if (isInteractiveTitlebarTarget(event.target)) return;
  void appWindow.toggleMaximize().then(syncMaximizedUi);
});

document.querySelector("#nav-back")!.addEventListener("click", () => {
  void invoke("server_history_back").catch(() => null);
});

document.querySelector("#nav-forward")!.addEventListener("click", () => {
  void invoke("server_history_forward").catch(() => null);
});

titlebarBrandBtn.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  void closeChromeMenu();
  postToServer({ type: "navigate", path: "/" });
});

menuBtn.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  void openAppMenu(menuBtn);
});

alertsBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  void closeChromeMenu();
  postToServer({ type: "open-notifications" });
});

profileBtn.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  void openAccountMenu(profileBtn);
});

void listen<{ id?: string }>("polarr-chrome-menu-action", (event) => {
  const id = event.payload?.id;
  if (!id) return;
  switch (id) {
    case "change-server":
      void changeServer();
      break;
    case "quit":
      void appWindow.close();
      break;
    case "profile":
      postToServer({ type: "navigate", path: "/profile" });
      break;
    case "settings":
      postToServer({ type: "navigate", path: "/settings" });
      break;
    case "admin":
      postToServer({ type: "navigate", path: "/admin" });
      break;
    case "logout":
      postToServer({ type: "logout" });
      break;
    default:
      break;
  }
});

function syncSearchActive() {
  const active =
    document.activeElement === searchInput || searchInput.value.length > 0;
  searchWrap.classList.toggle("is-active", active);
}

let searchTimer: number | null = null;
searchInput.addEventListener("focus", () => {
  syncSearchActive();
  postToServer({ type: "search", q: searchInput.value });
});
searchInput.addEventListener("blur", () => syncSearchActive());
searchInput.addEventListener("input", () => {
  syncSearchActive();
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    postToServer({ type: "search", q: searchInput.value });
  }, 120);
});
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchInput.blur();
  }
});

void appWindow.onResized(() => {
  void syncMaximizedUi();
});

async function bootstrap() {
  await syncMaximizedUi();
  // Never gate the main window on updater or server network requests. On slow
  // networks (especially at macOS cold start) that made the app appear hung.
  await revealMainWindow();
  try {
    await listen("server-cleared", () => {
      void showSetup(input.value);
    });
  } catch {
    // Non-Tauri preview.
  }

  void openUpdaterWindow();

  try {
    const saved = await invoke<{
      url: string | null;
      skipAutoConnect?: boolean;
    } | string | null>("get_server_url");
    const existing =
      typeof saved === "string" ? saved : saved && typeof saved === "object" ? saved.url : null;
    const skipAuto =
      saved && typeof saved === "object" && "skipAutoConnect" in saved
        ? Boolean(saved.skipAutoConnect)
        : false;
    if (existing) {
      input.value = existing;
    }
    if (existing && !skipAuto) {
      setConnectButton("Connecting…", true);
      try {
        const url = await invoke<string>("probe_server_url", { url: existing });
        await showServer(url);
      } catch {
        await showSetup(existing);
        showToast("URL not valid");
      }
    } else {
      await showSetup(existing ?? undefined);
      if (skipAuto) {
        showToast("URL not valid");
      }
    }
  } catch {
    await showSetup();
  }

}

void bootstrap();
