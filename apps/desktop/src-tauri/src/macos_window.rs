//! macOS window chrome: native rounded corners + dark WKWebView fill.
//!
//! Frameless (`decorations: false`) NSWindows are square. Overlay titlebar keeps
//! a real titled window (system continuous corners + traffic lights) while our
//! 48px HTML title bar draws underneath.
//!
//! WKWebView paints white until a page is ready. wry only disables that default
//! when its `transparent` feature is on, so we clear `drawsBackground` and set
//! the NSWindow color to Polarr dark (`#09090b`) from Objective-C.
//!
//! Child server webviews live in wry wrapper NSViews. We resize those wrappers
//! in place (never reparent the WKWebView itself) so the shell cannot cover
//! the server after Connect.

use std::ffi::{c_char, c_void, CString};

use tauri::{AppHandle, Manager, Webview};

use super::server_webview::TITLEBAR_HEIGHT;

extern "C" {
    fn polarr_macos_paint_window(ns_window: *mut c_void);
    fn polarr_macos_paint_webview(wk_webview: *mut c_void);
    fn polarr_macos_layout_connected(
        ns_window: *mut c_void,
        titlebar_h: f64,
        server_url: *const c_char,
    );
    fn polarr_macos_fill_shell(ns_window: *mut c_void);
}

pub fn apply(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let _ = window.set_theme(Some(tauri::Theme::Dark));
    let _ = window.set_shadow(true);
    if let Ok(ptr) = window.ns_window() {
        unsafe {
            polarr_macos_paint_window(ptr);
        }
    }
    if let Some(shell) = app.get_webview("main") {
        paint_shell(&shell);
    }
}

pub fn paint_shell(wv: &Webview) {
    let _ = wv.with_webview(|platform| unsafe {
        polarr_macos_paint_webview(platform.inner().cast());
        polarr_macos_paint_window(platform.ns_window().cast());
    });
}

/// Pin the shell wrapper to the 48px title bar and put the server wrapper under it.
pub fn layout_connected(app: &AppHandle, server_url: &str) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let c_url = CString::new(server_url).unwrap_or_else(|_| CString::new("").unwrap());
    if let Ok(ptr) = window.ns_window() {
        unsafe {
            polarr_macos_layout_connected(ptr, TITLEBAR_HEIGHT, c_url.as_ptr());
        }
    }
}

pub fn fill_shell(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    if let Ok(ptr) = window.ns_window() {
        unsafe {
            polarr_macos_fill_shell(ptr);
        }
    }
}
