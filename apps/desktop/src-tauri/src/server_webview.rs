//! First-party Polarr content webview (below the custom title bar).
//!
//! Loading the server in an HTML iframe made `polarr_token` a third-party
//! cookie (shell origin ≠ server origin) → login blink loop on WebView2.
//! A child Tauri webview navigates top-level to the server, so SameSite=Lax
//! session cookies stick.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

#[cfg(not(target_os = "macos"))]
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};

use serde_json::Value;
#[cfg(not(target_os = "macos"))]
use tauri::{webview::WebviewBuilder, WebviewUrl};
use tauri::{AppHandle, Emitter, Listener, LogicalPosition, LogicalSize, Manager};
use url::Url;

static LAST_SERVER_URL: Mutex<Option<String>> = Mutex::new(None);

fn remember_server_url(url: &str) {
    if let Ok(mut g) = LAST_SERVER_URL.lock() {
        *g = Some(url.to_string());
    }
}

fn last_server_url() -> Option<String> {
    LAST_SERVER_URL.lock().ok().and_then(|g| g.clone())
}

fn clear_server_url_memory() {
    if let Ok(mut g) = LAST_SERVER_URL.lock() {
        *g = None;
    }
}

pub(crate) fn forget_server_url() {
    clear_server_url_memory();
}

#[cfg(not(target_os = "macos"))]
fn href_is_blank(s: &str) -> bool {
    let t = s.trim();
    t.is_empty() || t.eq_ignore_ascii_case("about:blank") || t.starts_with("about:")
}

/// Overlay child webviews on macOS often stay at about:blank even when created
/// with WebviewUrl::External — the pane is WKWebView's default white.
#[cfg(not(target_os = "macos"))]
fn kick_server_load(wv: &tauri::Webview, url: &str) {
    match wv.url() {
        Ok(current) if !href_is_blank(current.as_str()) => return,
        _ => {}
    }
    if let Ok(parsed) = Url::parse(url) {
        let _ = wv.navigate(parsed);
    }
    if let Ok(href) = serde_json::to_string(url) {
        // Concatenate so JS braces cannot break format!.
        let script = [
            "(function(){ var u = ",
            href.as_str(),
            "; var h = String(location.href || ''); if (!h || h === 'about:blank' || h.indexOf('about:') === 0) location.replace(u); })();",
        ]
        .concat();
        let _ = wv.eval(&script);
    }
}

fn opening_lock_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("opening.lock"))
}

pub(crate) fn take_opening_crashed(app: &AppHandle) -> bool {
    let Some(path) = opening_lock_path(app) else {
        return false;
    };
    if path.exists() {
        let _ = fs::remove_file(&path);
        true
    } else {
        false
    }
}

fn mark_opening(app: &AppHandle) {
    if let Some(path) = opening_lock_path(app) {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(path, b"1");
    }
}

fn clear_opening(app: &AppHandle) {
    if let Some(path) = opening_lock_path(app) {
        let _ = fs::remove_file(path);
    }
}

pub(crate) fn clear_opening_marker(app: &AppHandle) {
    clear_opening(app);
}

pub const SERVER_WEBVIEW_LABEL: &str = "server";
/// Must match `--titlebar-h` in apps/desktop/src/styles.css
pub const TITLEBAR_HEIGHT: f64 = 48.0;

const CHROME_UP_EVENT: &str = "polarr-desktop-chrome-up";
const CHROME_DOWN_EVENT: &str = "polarr-desktop-chrome-down";

/// Injected on every document load.
/// Windows: hide the page header so the native title bar owns chrome.
/// macOS: never hide it — the in-page header is the overlay title bar, even
/// on older self-hosted builds that only understand `?desktop=1`.
pub const INIT_SCRIPT: &str = r#"
(function () {
  var agent = navigator.userAgent || "";
  var IS_MAC = /Macintosh|Mac OS X/i.test(agent) && !/iPhone|iPad|iPod/i.test(agent);

  // Only touch app chrome marked with data-polarr-app-header — NEVER bare
  // <header> (artist/playlist heroes use <header> too).
  var HIDE_ONLY_CSS =
    "html[data-polarr-desktop]:not([data-polarr-overlay-titlebar]) [data-polarr-app-header]{" +
    "display:none!important;height:0!important;max-height:0!important;min-height:0!important;" +
    "overflow:hidden!important;border:0!important;padding:0!important;margin:0!important;" +
    "visibility:hidden!important;pointer-events:none!important;opacity:0!important;" +
    "position:absolute!important;left:-9999px!important;top:0!important;width:0!important;" +
    "clip:rect(0,0,0,0)!important;flex:0 0 0!important;" +
    "}";

  // Higher specificity than older `html[data-polarr-desktop] [data-polarr-app-header]` hide rules.
  var OVERLAY_CSS =
    "html[data-polarr-overlay-titlebar] [data-polarr-app-header]," +
    "html[data-polarr-desktop][data-polarr-overlay-titlebar] [data-polarr-app-header]{" +
    "display:grid!important;height:48px!important;min-height:48px!important;max-height:48px!important;" +
    "grid-template-columns:minmax(86px,1fr) minmax(0,28rem) minmax(86px,1fr)!important;" +
    "align-items:center!important;gap:12px!important;padding:0 12px!important;margin:0!important;" +
    "overflow:visible!important;visibility:visible!important;pointer-events:auto!important;opacity:1!important;" +
    "position:relative!important;left:auto!important;top:auto!important;width:auto!important;" +
    "clip:auto!important;flex:0 0 48px!important;-webkit-app-region:drag!important;" +
    "}" +
    "html[data-polarr-overlay-titlebar] [data-polarr-app-header]~[data-polarr-app-header]{" +
    "display:none!important;height:0!important;min-height:0!important;max-height:0!important;" +
    "overflow:hidden!important;visibility:hidden!important;pointer-events:none!important;" +
    "flex:0 0 0!important;padding:0!important;margin:0!important;border:0!important;" +
    "}" +
    "html[data-polarr-overlay-titlebar] [data-polarr-app-header]>a:first-child{" +
    "justify-self:end!important;-webkit-app-region:no-drag!important;" +
    "}" +
    "html[data-polarr-overlay-titlebar] [data-polarr-app-header] a," +
    "html[data-polarr-overlay-titlebar] [data-polarr-app-header] button," +
    "html[data-polarr-overlay-titlebar] [data-polarr-app-header] input," +
    "html[data-polarr-overlay-titlebar] [data-polarr-app-header] [role=button]{" +
    "-webkit-app-region:no-drag!important;" +
    "}";

  var BASE_CSS =
    "html[data-polarr-desktop] [data-slot=scroll-area-viewport]," +
    "html[data-polarr-desktop] [data-radix-scroll-area-viewport]{" +
    "scrollbar-width:none!important;-ms-overflow-style:none!important;" +
    "}" +
    "html[data-polarr-desktop] [data-slot=scroll-area-viewport]::-webkit-scrollbar," +
    "html[data-polarr-desktop] [data-radix-scroll-area-viewport]::-webkit-scrollbar{" +
    "display:none!important;width:0!important;height:0!important;" +
    "}" +
    "html,body{background:#09090b!important;color-scheme:dark;}";

  var HIDE_CSS = HIDE_ONLY_CSS + OVERLAY_CSS + BASE_CSS;
  var MAC_CSS = OVERLAY_CSS + BASE_CSS;

  function ensureGlobal() {
    try {
      if (window.__POLARR_DESKTOP__ && window.__POLARR_DESKTOP__.chrome) return;
      Object.defineProperty(window, "__POLARR_DESKTOP__", {
        value: Object.freeze({
          version: "0.2.0",
          offline: true,
          discordRpc: true,
          chrome: true,
        }),
        configurable: true,
        enumerable: true,
        writable: false,
      });
    } catch (_) {
      try {
        window.__POLARR_DESKTOP__ = {
          version: "0.2.0",
          offline: true,
          discordRpc: true,
          chrome: true,
        };
      } catch (__) {}
    }
  }

  function ensureAttr() {
    try {
      // Overlay must land before data-polarr-desktop. Older servers hide the
      // header as soon as they see the desktop marker, and that hide wins if
      // overlay is applied even one frame later.
      if (IS_MAC) {
        if (document.documentElement.getAttribute("data-polarr-overlay-titlebar") !== "1") {
          document.documentElement.dataset.polarrOverlayTitlebar = "1";
          document.documentElement.setAttribute("data-polarr-overlay-titlebar", "1");
        }
        try {
          if (sessionStorage.getItem("polarr-desktop-overlay") !== "1") {
            sessionStorage.setItem("polarr-desktop-overlay", "1");
          }
        } catch (_) {}
      }
      if (document.documentElement.getAttribute("data-polarr-desktop") !== "1") {
        document.documentElement.dataset.polarrDesktop = "1";
        document.documentElement.setAttribute("data-polarr-desktop", "1");
      }
    } catch (_) {}
  }

  function ensureStorage() {
    try { sessionStorage.setItem("polarr-desktop", "1"); } catch (_) {}
  }

  function ensureClientIdentity() {
    try {
      var platform = /Windows/i.test(agent) ? "windows" :
        (IS_MAC ? "macos" :
        (/Linux/i.test(agent) ? "linux" : "desktop"));
      document.cookie = "polarr_desktop_platform=" + platform +
        "; Path=/; SameSite=Lax";
    } catch (_) {}
  }

  function upsertStyle(id, css, pinLast) {
    var root = document.body || document.head || document.documentElement;
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      el.textContent = css;
      root.appendChild(el);
      return;
    }
    if (el.textContent !== css) el.textContent = css;
    if (pinLast && (el.parentNode !== root || root.lastChild !== el)) {
      root.appendChild(el);
    }
  }

  function ensureStyle() {
    try {
      if (IS_MAC) {
        // Older DesktopChromeBridge overwrites #polarr-desktop-hide-header with
        // hide-only CSS. Neutralize that sheet and keep a dedicated overlay sheet.
        upsertStyle("polarr-desktop-hide-header", MAC_CSS, false);
        upsertStyle("polarr-desktop-overlay-header", MAC_CSS, true);
      } else {
        upsertStyle("polarr-desktop-hide-header", HIDE_CSS, false);
      }
    } catch (_) {}
  }

  function clearHideStyles(h) {
    h.removeAttribute("hidden");
    h.style.removeProperty("display");
    h.style.removeProperty("height");
    h.style.removeProperty("min-height");
    h.style.removeProperty("max-height");
    h.style.removeProperty("overflow");
    h.style.removeProperty("visibility");
    h.style.removeProperty("pointer-events");
    h.style.removeProperty("opacity");
    h.style.removeProperty("position");
    h.style.removeProperty("left");
    h.style.removeProperty("clip");
    h.style.removeProperty("flex");
  }

  function nukeHeaders() {
    try {
      var list = document.querySelectorAll("[data-polarr-app-header]");
      // macOS always preserves the in-page header, even if overlay attr lost a race.
      var overlay = IS_MAC ||
        document.documentElement.getAttribute("data-polarr-overlay-titlebar") === "1";
      for (var i = 0; i < list.length; i++) {
        var h = list[i];
        if (overlay) {
          if (i > 0) {
            if (h.getAttribute("hidden") == null) h.setAttribute("hidden", "");
            if (h.style.getPropertyValue("display") !== "none") {
              h.style.setProperty("display", "none", "important");
            }
            continue;
          }
          clearHideStyles(h);
          continue;
        }
        if (h.getAttribute("hidden") == null) h.setAttribute("hidden", "");
        if (h.style.getPropertyValue("display") !== "none") {
          h.style.setProperty("display", "none", "important");
        }
        h.style.setProperty("height", "0", "important");
        h.style.setProperty("max-height", "0", "important");
        h.style.setProperty("overflow", "hidden", "important");
        h.style.setProperty("visibility", "hidden", "important");
        h.style.setProperty("pointer-events", "none", "important");
      }
    } catch (_) {}
  }

  var applyingMarkers = false;
  function applyDesktopMarkers() {
    if (applyingMarkers) return;
    applyingMarkers = true;
    try {
      ensureGlobal();
      ensureStorage();
      ensureClientIdentity();
      ensureAttr();
      ensureStyle();
      nukeHeaders();
    } finally {
      applyingMarkers = false;
    }
  }

  function getInvoke() {
    try {
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
      }
    } catch (_) {}
    try {
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        return window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
      }
    } catch (_) {}
    return null;
  }

  function isAuthPath(path) {
    return (
      path === "/login" ||
      path === "/setup" ||
      path === "/join" ||
      path === "/forgot-password" ||
      path === "/reset-password" ||
      (path && path.indexOf("/reset-password") === 0)
    );
  }

  function absolutize(url) {
    if (!url) return null;
    try {
      return new URL(url, location.origin).href;
    } catch (_) {
      return url;
    }
  }

  function scrapeAvatar() {
    try {
      var btn = document.querySelector("[data-polarr-user-avatar]");
      if (btn) {
        var userImg = btn.querySelector("img");
        if (userImg && userImg.src && userImg.src.indexOf("polarr-icon") === -1) {
          return absolutize(userImg.src);
        }
      }
      var imgs = document.querySelectorAll(
        'header button img, [data-polarr-app-header] button img'
      );
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (img && img.src && img.src.indexOf("polarr-icon") === -1) {
          return absolutize(img.src);
        }
      }
    } catch (_) {}
    return null;
  }

  function scrapeName() {
    try {
      var el = document.querySelector("[data-polarr-username]");
      if (el && el.textContent) return el.textContent.trim();
    } catch (_) {}
    return null;
  }

  function avatarToDataUrl(src) {
    return new Promise(function (resolve) {
      if (!src) {
        resolve(null);
        return;
      }
      if (
        window.__polarrAvatarCache &&
        window.__polarrAvatarCache.src === src &&
        window.__polarrAvatarCache.dataUrl
      ) {
        resolve(window.__polarrAvatarCache.dataUrl);
        return;
      }
      fetch(src, { credentials: "include", cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error("avatar http");
          return res.blob();
        })
        .then(function (blob) {
          if (!blob || !blob.size) {
            resolve(null);
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            var dataUrl =
              typeof reader.result === "string" ? reader.result : null;
            if (dataUrl) {
              window.__polarrAvatarCache = { src: src, dataUrl: dataUrl };
            }
            resolve(dataUrl);
          };
          reader.onerror = function () {
            resolve(null);
          };
          reader.readAsDataURL(blob);
        })
        .catch(function () {
          resolve(null);
        });
    });
  }

  function reportChrome() {
    try {
      var path = location.pathname || "/";
      var authRoute = isAuthPath(path);
      var inv = getInvoke();
      if (!inv) return;
      if (window.__polarrChromeReportBusy) return;
      window.__polarrChromeReportBusy = true;

      var searchQuery =
        path === "/search"
          ? new URLSearchParams(location.search).get("q") || ""
          : null;

      var finish = function (payload) {
        window.__polarrChromeReportBusy = false;
        var msg = {
          channel: "polarr-desktop-chrome",
          type: "auth",
          payload: payload,
        };
        inv("desktop_chrome_up", { message: msg }).catch(function () {});
      };

      if (authRoute) {
        finish({
          authenticated: false,
          username: null,
          avatarUrl: null,
          avatarDataUrl: null,
          isStaff: false,
          pathname: path,
          searchQuery: searchQuery,
          notificationUnread: 0,
        });
        return;
      }

      fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
        .then(function (res) {
          if (!res.ok) return null;
          return res.json();
        })
        .then(function (data) {
          var user = data && data.user;
          if (!user) {
            finish({
              authenticated: false,
              username: scrapeName(),
              avatarUrl: scrapeAvatar(),
              avatarDataUrl: null,
              isStaff: false,
              pathname: path,
              searchQuery: searchQuery,
              notificationUnread: 0,
            });
            return null;
          }
          var role = user.role || (data && data.role) || "";
          var isStaff =
            role === "admin" ||
            role === "owner" ||
            role === "moderator" ||
            role === "staff";
          var avatarUrl = absolutize(user.avatarUrl) || scrapeAvatar();
          var username =
            (typeof user.username === "string" && user.username) ||
            scrapeName();
          return avatarToDataUrl(avatarUrl).then(function (avatarDataUrl) {
            finish({
              authenticated: true,
              username: username,
              avatarUrl: avatarUrl,
              avatarDataUrl: avatarDataUrl,
              isStaff: isStaff,
              pathname: path,
              searchQuery: searchQuery,
              notificationUnread: 0,
            });
          });
        })
        .catch(function () {
          var avatarUrl = scrapeAvatar();
          return avatarToDataUrl(avatarUrl).then(function (avatarDataUrl) {
            finish({
              authenticated: !authRoute,
              username: scrapeName(),
              avatarUrl: avatarUrl,
              avatarDataUrl: avatarDataUrl,
              isStaff: false,
              pathname: path,
              searchQuery: searchQuery,
              notificationUnread: 0,
            });
          });
        })
        .finally(function () {
          window.__polarrChromeReportBusy = false;
        });
    } catch (_) {
      window.__polarrChromeReportBusy = false;
    }
  }

  function handleChromeDown(detail) {
    if (!detail || !detail.type) return;
    try {
      if (detail.type === "hello" || detail.type === "ping") {
        applyDesktopMarkers();
        reportChrome();
        return;
      }
      // navigate / search / open-* / logout: DesktopChromeBridge owns SPA routing.
      // Never location.assign here — hard nav tears down the audio element.
      if (
        detail.type === "navigate" ||
        detail.type === "open-notifications" ||
        detail.type === "open-profile" ||
        detail.type === "search" ||
        detail.type === "logout"
      ) {
        return;
      }
    } catch (_) {}
  }

  applyDesktopMarkers();

  try {
    if (!window.__polarrDesktopMo) {
      window.__polarrDesktopMo = new MutationObserver(function () {
        applyDesktopMarkers();
      });
      window.__polarrDesktopMo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [
          "data-polarr-desktop",
          "data-polarr-overlay-titlebar",
          "class",
        ],
      });
    }
  } catch (_) {}

  try {
    if (!window.__polarrHeaderMo && document.documentElement) {
      window.__polarrHeaderMo = new MutationObserver(function () {
        // Re-run the full marker pass so macOS overlay is restored if an older
        // page hid the header between mutations.
        applyDesktopMarkers();
      });
      var startObs = function () {
        try {
          window.__polarrHeaderMo.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
          });
        } catch (_) {}
      };
      if (document.body) startObs();
      else document.addEventListener("DOMContentLoaded", startObs);
    }
  } catch (_) {}

  try {
    if (!window.__polarrDesktopHistHooked) {
      window.__polarrDesktopHistHooked = true;
      var wrap = function (key) {
        var orig = history[key];
        if (typeof orig !== "function") return;
        history[key] = function () {
          var ret = orig.apply(this, arguments);
          try {
            applyDesktopMarkers();
            reportChrome();
          } catch (_) {}
          return ret;
        };
      };
      wrap("pushState");
      wrap("replaceState");
      window.addEventListener("popstate", function () {
        applyDesktopMarkers();
        reportChrome();
      });
    }
  } catch (_) {}

  try {
    document.addEventListener("DOMContentLoaded", function () {
      applyDesktopMarkers();
      reportChrome();
    });
    window.addEventListener("load", function () {
      applyDesktopMarkers();
      reportChrome();
    });
  } catch (_) {}

  try {
    if (!window.__polarrChromeDownHooked) {
      window.__polarrChromeDownHooked = true;
      window.addEventListener("polarr-chrome-down", function (ev) {
        handleChromeDown(ev && ev.detail);
      });
    }
  } catch (_) {}

  try {
    [0, 50, 150, 400, 1000, 2500].forEach(function (ms) {
      setTimeout(function () {
        applyDesktopMarkers();
        reportChrome();
      }, ms);
    });
    if (!window.__polarrChromeReportTimer) {
      window.__polarrChromeReportTimer = setInterval(function () {
        applyDesktopMarkers();
        reportChrome();
      }, 8000);
    }
  } catch (_) {}
})();
"#;

fn window_logical_size(window: &tauri::Window) -> Result<LogicalSize<f64>, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let physical = window.inner_size().map_err(|e| e.to_string())?;
    Ok(physical.to_logical(scale))
}

fn content_bounds(
    window: &tauri::Window,
) -> Result<(LogicalPosition<f64>, LogicalSize<f64>), String> {
    let logical = window_logical_size(window)?;
    let height = (logical.height - TITLEBAR_HEIGHT).max(80.0);
    let width = logical.width.max(320.0);
    Ok((
        LogicalPosition::new(0.0, TITLEBAR_HEIGHT),
        LogicalSize::new(width, height),
    ))
}

fn set_webview_frame(
    wv: &tauri::Webview,
    pos: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> Result<(), String> {
    let _ = wv.set_auto_resize(false);
    wv.set_position(pos)
        .map_err(|e| format!("webview position: {e}"))?;
    wv.set_size(size)
        .map_err(|e| format!("webview size: {e}"))?;
    Ok(())
}

fn run_on_main_sync<T, F>(app: &AppHandle, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| format!("dispatch main thread: {e}"))?;
    rx.recv_timeout(Duration::from_secs(8))
        .map_err(|_| "timed out waiting for the UI thread".to_string())?
}

/// The shell webview fills the whole window by default. On macOS that opaque
/// WKWebView covers `add_child` content, so pin it to the 48px title bar while
/// the server view is open.
fn pin_shell_to_titlebar(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    let Some(shell) = app.get_webview("main") else {
        return Err("shell webview missing".to_string());
    };
    let logical = window_logical_size(&window)?;
    set_webview_frame(
        &shell,
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(logical.width.max(1.0), TITLEBAR_HEIGHT),
    )?;
    let _ = shell.show();
    Ok(())
}

pub(crate) fn fill_shell(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    let Some(shell) = app.get_webview("main") else {
        return Ok(());
    };
    let logical = window_logical_size(&window)?;
    let _ = shell.set_auto_resize(true);
    set_webview_frame(&shell, LogicalPosition::new(0.0, 0.0), logical)?;
    let _ = shell.show();
    #[cfg(target_os = "macos")]
    crate::macos_window::fill_shell(app);
    Ok(())
}

fn apply_layout(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    let Some(wv) = app.get_webview(SERVER_WEBVIEW_LABEL) else {
        return Ok(());
    };
    pin_shell_to_titlebar(app)?;
    let (pos, size) = content_bounds(&window)?;
    set_webview_frame(&wv, pos, size)?;
    let _ = wv.show();
    let url = last_server_url()
        .unwrap_or_else(|| wv.url().ok().map(|u| u.to_string()).unwrap_or_default());
    #[cfg(not(target_os = "macos"))]
    if !url.is_empty() {
        kick_server_load(&wv, &url);
    }
    #[cfg(target_os = "macos")]
    crate::macos_window::layout_connected(app, &url);
    Ok(())
}

fn dispatch_layout(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(err) = apply_layout(&handle) {
            eprintln!("polarr layout: {err}");
        }
    });
}

pub(crate) fn dispatch_fill_shell(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = fill_shell(&handle);
    });
}

fn apply_layout_on_main(app: &AppHandle) {
    let handle = app.clone();
    let _ = run_on_main_sync(&handle.clone(), move || apply_layout(&handle));
}

fn parse_external(url: &str) -> Result<Url, String> {
    Url::parse(url).map_err(|e| format!("invalid server URL: {e}"))
}

#[cfg(not(target_os = "macos"))]
fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host() == b.host()
        && a.port_or_known_default() == b.port_or_known_default()
}

fn reassert_desktop_markers(wv: &tauri::Webview) {
    let _ = wv.eval(INIT_SCRIPT);
}

#[cfg(target_os = "macos")]
fn reassert_macos_overlay(wv: &tauri::Webview) {
    reassert_desktop_markers(wv);
    let _ = wv.eval(
        r#"(function () {
          try {
            document.documentElement.dataset.polarrOverlayTitlebar = "1";
            document.documentElement.setAttribute("data-polarr-overlay-titlebar", "1");
            sessionStorage.setItem("polarr-desktop-overlay", "1");
            window.dispatchEvent(new Event("polarr-desktop-mode"));
          } catch (_) {}
        })();"#,
    );
}

#[cfg(target_os = "macos")]
fn schedule_main_marker_kicks(app: AppHandle) {
    std::thread::spawn(move || {
        // Do not evaluate into the old bundled document while WKWebView is
        // committing its top-level navigation; doing so can interrupt the
        // handoff and leave only the shell background visible.
        for ms in [1000_u64, 1500, 2500, 5000] {
            std::thread::sleep(Duration::from_millis(ms));
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(wv) = handle.get_webview("main") {
                    reassert_macos_overlay(&wv);
                }
            });
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn schedule_marker_kicks(app: AppHandle) {
    std::thread::spawn(move || {
        for ms in [80_u64, 250, 600, 1200, 2500, 5000] {
            std::thread::sleep(Duration::from_millis(ms));
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(wv) = handle.get_webview(SERVER_WEBVIEW_LABEL) {
                    reassert_desktop_markers(&wv);
                    let _ = apply_layout(&handle);
                }
            });
        }
    });
}

fn eval_chrome_command(wv: &tauri::Webview, raw: &str) {
    // SPA bridge (DesktopChromeBridge) handles navigate/search/open-*/logout via
    // this CustomEvent. Do not location.assign — hard nav unloads the document
    // and pauses/resets the player mid-song.
    let js_event = format!(
        "try{{window.dispatchEvent(new CustomEvent('polarr-chrome-down',{{detail:{raw}}}));}}catch(e){{}}"
    );
    let _ = wv.eval(&js_event);

    if let Ok(v) = serde_json::from_str::<Value>(raw) {
        let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if matches!(ty, "hello" | "ping") {
            reassert_desktop_markers(wv);
        }
    }
}

/// Relay auth/ready from the server webview → shell (main).
#[tauri::command]
pub fn desktop_chrome_up(app: AppHandle, message: Value) -> Result<(), String> {
    app.emit(CHROME_UP_EVENT, message)
        .map_err(|e| format!("chrome up: {e}"))
}

/// Current server webview URL (for shell chrome without depending on web bridge).
#[tauri::command]
pub fn get_server_webview_href(app: AppHandle) -> Result<Option<String>, String> {
    let Some(wv) = app.get_webview(SERVER_WEBVIEW_LABEL) else {
        return Ok(None);
    };
    match wv.url() {
        Ok(u) => Ok(Some(u.to_string())),
        Err(e) => Err(format!("server url: {e}")),
    }
}

/// Wire shell → server chrome commands (CustomEvent + direct location assign).
pub fn install_chrome_down_relay(app: &AppHandle) {
    let handle = app.clone();
    app.listen(CHROME_DOWN_EVENT, move |event| {
        let Some(wv) = handle.get_webview(SERVER_WEBVIEW_LABEL) else {
            return;
        };
        eval_chrome_command(&wv, event.payload());
    });
}

/// Keep the content webview tucked under the 48px title bar on resize.
pub fn install_resize_handler(app: &AppHandle) {
    let handle = app.clone();
    if let Some(window) = app.get_window("main") {
        let _ = window.on_window_event(move |event| {
            if matches!(
                event,
                tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
                    | tauri::WindowEvent::Focused(_)
            ) {
                dispatch_layout(&handle);
            }
        });
    }
}

/// Create or reveal the content webview and navigate to `url` (already normalized).
#[tauri::command]
pub async fn open_server_webview(app: AppHandle, url: String) -> Result<(), String> {
    mark_opening(&app);
    let result = open_server_webview_inner(app.clone(), url);
    clear_opening(&app);
    if result.is_err() {
        // Opening is a transaction: never leave the shell pinned to the title
        // bar when child-webview creation or navigation fails. That state makes
        // the entire setup UI look like a black screen and prevents the user
        // from correcting the URL without restarting the app.
        let rollback = app.clone();
        let _ = run_on_main_sync(&app, move || {
            if let Some(wv) = rollback.get_webview(SERVER_WEBVIEW_LABEL) {
                let _ = wv.close();
            }
            clear_server_url_memory();
            fill_shell(&rollback)
        });
    }
    result
}

#[cfg(target_os = "macos")]
fn open_server_webview_inner(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = parse_external(&url)?;
    remember_server_url(&url);
    let main = app
        .get_webview("main")
        .ok_or_else(|| "main webview missing".to_string())?;

    // Nested WKWebViews intermittently paint only their background even after
    // WebKit has accepted and started the remote request. The primary WKWebView
    // already rendered the updater and connection UI reliably, so reuse it as
    // the top-level browsing context on macOS. `?desktop=1&titlebar=overlay`
    // keeps the web header as the 48px title bar under native traffic lights.
    main.navigate(parsed)
        .map_err(|e| format!("open Polarr server: {e}"))?;
    // Redirects through /login can drop the desktop/titlebar query string.
    // Reassert the native-shell markers on the destination document so macOS
    // always uses the centered search + adjacent logo layout after navigation.
    schedule_main_marker_kicks(app.clone());
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn open_server_webview_inner(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = parse_external(&url)?;

    // WebView2 must be created and driven on the UI thread. Tauri runs async
    // commands on a worker thread, so hop to main before creating the child.
    // Creating the child webview off the UI thread on Windows
    // leaves WebView2 painting only its background color — a black content area
    // below the title bar — until a later main-thread layout or resize forces it
    // to composite.
    let handle = app.clone();
    let ready = run_on_main_sync(&app, move || create_or_reveal_server(&handle, parsed, url))?;

    // WebView2 can stay hidden until its first document reports Finished.
    if let Some(ready) = ready {
        ready.recv_timeout(Duration::from_secs(20)).map_err(|_| {
            "The server page did not finish loading. Check the URL and try again.".to_string()
        })?;

        // The new child has loaded successfully while hidden. Reveal it and
        // shrink the setup shell as one UI-thread operation so there is always
        // a usable surface covering the window during the hand-off.
        let handle = app.clone();
        run_on_main_sync(&app, move || {
            apply_layout(&handle)?;
            if let Some(wv) = handle.get_webview(SERVER_WEBVIEW_LABEL) {
                let _ = wv.set_focus();
            }
            Ok(())
        })?;
        schedule_marker_kicks(app.clone());
        schedule_connected_retries(app.clone());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn schedule_connected_retries(app: AppHandle) {
    for ms in [80_u64, 200, 500, 1200] {
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(ms));
            let for_main = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                #[cfg(not(target_os = "macos"))]
                if let Some(url) = last_server_url() {
                    if let Some(wv) = for_main.get_webview(SERVER_WEBVIEW_LABEL) {
                        kick_server_load(&wv, &url);
                    }
                }
                if let Err(err) = apply_layout(&for_main) {
                    eprintln!("polarr layout retry: {err}");
                }
            });
        });
    }
}

#[cfg(not(target_os = "macos"))]
fn create_or_reveal_server(
    app: &AppHandle,
    parsed: Url,
    url: String,
) -> Result<Option<mpsc::Receiver<()>>, String> {
    remember_server_url(&url);
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    if let Some(existing) = app.get_webview(SERVER_WEBVIEW_LABEL) {
        let should_navigate = match existing.url() {
            Ok(current) => href_is_blank(current.as_str()) || !same_origin(&current, &parsed),
            Err(_) => true,
        };
        #[cfg(not(target_os = "macos"))]
        if should_navigate {
            let _ = existing.navigate(parsed.clone());
            let href = serde_json::to_string(&url).map_err(|e| e.to_string())?;
            existing
                .eval(&format!("window.location.replace({href})"))
                .map_err(|e| format!("navigate server webview: {e}"))?;
        } else {
            reassert_desktop_markers(&existing);
        }
        #[cfg(target_os = "macos")]
        if !should_navigate {
            reassert_desktop_markers(&existing);
        }
        apply_layout(app)?;
        existing
            .show()
            .map_err(|e| format!("show server webview: {e}"))?;
        let _ = existing.set_focus();
        schedule_marker_kicks(app.clone());
        schedule_connected_retries(app.clone());
        return Ok(None);
    }

    let (pos, size) = content_bounds(&window)?;
    // On macOS, beginning navigation inside add_child races the WKWebView's
    // attachment to its NSWindow and can leave a healthy server on a blank
    // background. Attach an about:blank view first; native layout starts the
    // remote request only after the view hierarchy and frames are established.
    #[cfg(target_os = "macos")]
    let initial_url = WebviewUrl::External(
        Url::parse("about:blank").map_err(|e| format!("create blank server URL: {e}"))?,
    );
    #[cfg(not(target_os = "macos"))]
    let initial_url = WebviewUrl::External(parsed.clone());
    let builder = WebviewBuilder::new(SERVER_WEBVIEW_LABEL, initial_url)
        .initialization_script(INIT_SCRIPT)
        .focused(true)
        .background_color(tauri::webview::Color(9, 9, 11, 255));
    #[cfg(target_os = "macos")]
    let ready_rx: Option<mpsc::Receiver<()>> = None;
    #[cfg(not(target_os = "macos"))]
    let (builder, ready_rx) = {
        let (ready_tx, ready_rx) = mpsc::channel();
        let callback_target = parsed.clone();
        let callback_once = Arc::new(AtomicBool::new(false));
        let builder = builder.on_page_load(move |_webview, payload| {
            if !matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
                || href_is_blank(payload.url().as_str())
                || !same_origin(payload.url(), &callback_target)
                || callback_once.swap(true, Ordering::SeqCst)
            {
                return;
            }
            let _ = ready_tx.send(());
        });
        (builder, Some(ready_rx))
    };

    // Keep the setup shell full-size until the child exists. In particular,
    // WebView2/WKWebView creation can fail for machine-specific reasons; if we
    // shrink the only working webview first, the resulting error is hidden in
    // the 48px title bar and the rest of the window appears black.
    let wv = window
        .add_child(builder, pos, size)
        .map_err(|e| format!("create server webview: {e}"))?;
    // WebView2 can load while hidden, keeping its unpainted background behind
    // the setup shell until Finished. Hiding WKWebView can suspend navigation,
    // so macOS keeps the blank child live and performs the native handoff now.
    #[cfg(not(target_os = "macos"))]
    if let Err(err) = wv.hide() {
        let _ = wv.close();
        return Err(format!("hide loading server webview: {err}"));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = wv.navigate(parsed);
        kick_server_load(&wv, &url);
    }
    #[cfg(target_os = "macos")]
    {
        // apply_layout attaches and sizes the blank child before the Objective-C
        // bridge calls loadRequest. Do not call kick_server_load on macOS: that
        // would reintroduce the pre-attachment navigation race.
        apply_layout(app)?;
        let _ = wv.set_focus();
        schedule_marker_kicks(app.clone());
        schedule_connected_retries(app.clone());
    }
    Ok(ready_rx)
}

#[tauri::command]
pub async fn hide_server_webview(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(SERVER_WEBVIEW_LABEL) {
        wv.hide().map_err(|e| format!("hide server webview: {e}"))?;
    }
    dispatch_fill_shell(&app);
    Ok(())
}

#[tauri::command]
pub async fn show_server_webview(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(SERVER_WEBVIEW_LABEL) {
        apply_layout_on_main(&app);
        wv.show().map_err(|e| format!("show server webview: {e}"))?;
        let _ = wv.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub async fn close_server_webview(app: AppHandle) -> Result<(), String> {
    clear_server_url_memory();
    if let Some(wv) = app.get_webview(SERVER_WEBVIEW_LABEL) {
        wv.close()
            .map_err(|e| format!("close server webview: {e}"))?;
    }
    dispatch_fill_shell(&app);
    Ok(())
}

#[tauri::command]
pub fn server_history_back(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(SERVER_WEBVIEW_LABEL) {
        wv.eval("window.history.back()")
            .map_err(|e| format!("history back: {e}"))?;
        reassert_desktop_markers(&wv);
    }
    Ok(())
}

#[tauri::command]
pub fn server_history_forward(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(SERVER_WEBVIEW_LABEL) {
        wv.eval("window.history.forward()")
            .map_err(|e| format!("history forward: {e}"))?;
        reassert_desktop_markers(&wv);
    }
    Ok(())
}
