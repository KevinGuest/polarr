//! First-party Polarr content webview (below the custom title bar).
//!
//! Loading the server in an HTML iframe made `polarr_token` a third-party
//! cookie (shell origin ≠ server origin) → login blink loop on WebView2.
//! A child Tauri webview navigates top-level to the server, so SameSite=Lax
//! session cookies stick.

use std::time::Duration;

use serde_json::Value;
use tauri::{
    AppHandle, Emitter, Listener, LogicalPosition, LogicalSize, Manager, WebviewUrl,
    webview::WebviewBuilder,
};
use url::Url;

pub const SERVER_WEBVIEW_LABEL: &str = "server";
/// Must match `--titlebar-h` in apps/desktop/src/styles.css
pub const TITLEBAR_HEIGHT: f64 = 48.0;

const CHROME_UP_EVENT: &str = "polarr-desktop-chrome-up";
const CHROME_DOWN_EVENT: &str = "polarr-desktop-chrome-down";

/// Injected on every document load. Hard-hides web `<header>` even on old
/// production builds that lack `data-polarr-app-header` / DesktopChromeBridge.
pub const INIT_SCRIPT: &str = r#"
(function () {
  // Only hide app chrome marked with data-polarr-app-header — NEVER bare
  // <header> (artist/playlist heroes use <header> too).
  // Also hide native scrollbars on Radix ScrollArea so WebView2 doesn't stack
  // OS overlay bars on top of the custom thumb.
  var HIDE_CSS =
    "html[data-polarr-desktop] [data-polarr-app-header]{" +
    "display:none!important;height:0!important;max-height:0!important;min-height:0!important;" +
    "overflow:hidden!important;border:0!important;padding:0!important;margin:0!important;" +
    "visibility:hidden!important;pointer-events:none!important;opacity:0!important;" +
    "position:absolute!important;left:-9999px!important;top:0!important;width:0!important;" +
    "clip:rect(0,0,0,0)!important;flex:0 0 0!important;" +
    "}" +
    "html[data-polarr-desktop] [data-slot=scroll-area-viewport]," +
    "html[data-polarr-desktop] [data-radix-scroll-area-viewport]{" +
    "scrollbar-width:none!important;-ms-overflow-style:none!important;" +
    "}" +
    "html[data-polarr-desktop] [data-slot=scroll-area-viewport]::-webkit-scrollbar," +
    "html[data-polarr-desktop] [data-radix-scroll-area-viewport]::-webkit-scrollbar{" +
    "display:none!important;width:0!important;height:0!important;" +
    "}";

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
      document.documentElement.dataset.polarrDesktop = "1";
      document.documentElement.setAttribute("data-polarr-desktop", "1");
    } catch (_) {}
  }

  function ensureStorage() {
    try { sessionStorage.setItem("polarr-desktop", "1"); } catch (_) {}
  }

  function ensureStyle() {
    try {
      var el = document.getElementById("polarr-desktop-hide-header");
      if (!el) {
        el = document.createElement("style");
        el.id = "polarr-desktop-hide-header";
        el.textContent = HIDE_CSS;
        (document.body || document.head || document.documentElement).appendChild(el);
      } else {
        el.textContent = HIDE_CSS;
      }
    } catch (_) {}
  }

  function nukeHeaders() {
    try {
      var list = document.querySelectorAll("[data-polarr-app-header]");
      for (var i = 0; i < list.length; i++) {
        var h = list[i];
        h.setAttribute("hidden", "");
        h.style.setProperty("display", "none", "important");
        h.style.setProperty("height", "0", "important");
        h.style.setProperty("max-height", "0", "important");
        h.style.setProperty("overflow", "hidden", "important");
        h.style.setProperty("visibility", "hidden", "important");
        h.style.setProperty("pointer-events", "none", "important");
      }
    } catch (_) {}
  }

  function applyDesktopMarkers() {
    ensureGlobal();
    ensureStorage();
    ensureAttr();
    ensureStyle();
    nukeHeaders();
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
        attributeFilter: ["data-polarr-desktop", "class"],
      });
    }
  } catch (_) {}

  try {
    if (!window.__polarrHeaderMo && document.documentElement) {
      window.__polarrHeaderMo = new MutationObserver(function () {
        nukeHeaders();
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

fn content_bounds(window: &tauri::Window) -> Result<(LogicalPosition<f64>, LogicalSize<f64>), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let physical = window.inner_size().map_err(|e| e.to_string())?;
    let logical: LogicalSize<f64> = physical.to_logical(scale);
    let height = (logical.height - TITLEBAR_HEIGHT).max(80.0);
    let width = logical.width.max(320.0);
    Ok((
        LogicalPosition::new(0.0, TITLEBAR_HEIGHT),
        LogicalSize::new(width, height),
    ))
}

fn apply_layout(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    let Some(wv) = app.get_webview(SERVER_WEBVIEW_LABEL) else {
        return Ok(());
    };
    let (pos, size) = content_bounds(&window)?;
    wv.set_position(pos)
        .map_err(|e| format!("position server webview: {e}"))?;
    wv.set_size(size)
        .map_err(|e| format!("size server webview: {e}"))?;
    Ok(())
}

fn parse_external(url: &str) -> Result<Url, String> {
    Url::parse(url).map_err(|e| format!("invalid server URL: {e}"))
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host() == b.host()
        && a.port_or_known_default() == b.port_or_known_default()
}

fn reassert_desktop_markers(wv: &tauri::Webview) {
    let _ = wv.eval(INIT_SCRIPT);
}

fn schedule_marker_kicks(app: AppHandle) {
    std::thread::spawn(move || {
        for ms in [80_u64, 250, 600, 1200, 2500, 5000] {
            std::thread::sleep(Duration::from_millis(ms));
            if let Some(wv) = app.get_webview(SERVER_WEBVIEW_LABEL) {
                reassert_desktop_markers(&wv);
                let _ = apply_layout(&app);
            } else {
                break;
            }
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
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                let _ = apply_layout(&handle);
            }
        });
    }
}

/// Create or reveal the content webview and navigate to `url` (already normalized).
#[tauri::command]
pub async fn open_server_webview(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = parse_external(&url)?;
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    if let Some(existing) = app.get_webview(SERVER_WEBVIEW_LABEL) {
        let should_navigate = match existing.url() {
            Ok(current) => !same_origin(&current, &parsed),
            Err(_) => true,
        };
        if should_navigate {
            let href = serde_json::to_string(&url).map_err(|e| e.to_string())?;
            existing
                .eval(&format!("window.location.replace({href})"))
                .map_err(|e| format!("navigate server webview: {e}"))?;
        } else {
            reassert_desktop_markers(&existing);
        }
        apply_layout(&app)?;
        existing
            .show()
            .map_err(|e| format!("show server webview: {e}"))?;
        let _ = existing.set_focus();
        schedule_marker_kicks(app.clone());
        return Ok(());
    }

    let (pos, size) = content_bounds(&window)?;
    let builder = WebviewBuilder::new(SERVER_WEBVIEW_LABEL, WebviewUrl::External(parsed))
        .initialization_script(INIT_SCRIPT)
        .focused(true);

    window
        .add_child(builder, pos, size)
        .map_err(|e| format!("create server webview: {e}"))?;

    schedule_marker_kicks(app);
    Ok(())
}

#[tauri::command]
pub async fn hide_server_webview(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(SERVER_WEBVIEW_LABEL) {
        wv.hide()
            .map_err(|e| format!("hide server webview: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn show_server_webview(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(SERVER_WEBVIEW_LABEL) {
        apply_layout(&app)?;
        wv.show()
            .map_err(|e| format!("show server webview: {e}"))?;
        let _ = wv.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub async fn close_server_webview(app: AppHandle) -> Result<(), String> {
    if let Some(wv) = app.get_webview(SERVER_WEBVIEW_LABEL) {
        wv.close()
            .map_err(|e| format!("close server webview: {e}"))?;
    }
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
