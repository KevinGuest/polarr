//! macOS window chrome: native rounded corners + dark WKWebView fill.
//!
//! Frameless (`decorations: false`) NSWindows are square. Overlay titlebar keeps
//! a real titled window (system continuous corners + traffic lights) while our
//! 48px HTML title bar draws underneath.
//!
//! WKWebView paints white until a page is ready. wry only disables that default
//! when its `transparent` feature is on, so we clear `drawsBackground` and set
//! the NSWindow color to Polarr dark (`#09090b`) from Objective-C.

use std::ffi::c_void;

use tauri::{AppHandle, Manager, TitleBarStyle, Webview};

use super::server_webview::SERVER_WEBVIEW_LABEL;

extern "C" {
    fn polarr_macos_paint_window(ns_window: *mut c_void);
    fn polarr_macos_paint_webview(wk_webview: *mut c_void);
}

pub fn apply(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let _ = window.set_theme(Some(tauri::Theme::Dark));
    let _ = window.set_shadow(true);
    let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
    if let Ok(ptr) = window.ns_window() {
        unsafe {
            polarr_macos_paint_window(ptr);
        }
    }
    if let Some(shell) = app.get_webview("main") {
        paint_webview(&shell);
    }
    if let Some(server) = app.get_webview(SERVER_WEBVIEW_LABEL) {
        paint_webview(&server);
    }
}

pub fn paint_webview(wv: &Webview) {
    let _ = wv.with_webview(|platform| unsafe {
        polarr_macos_paint_webview(platform.inner().cast());
        polarr_macos_paint_window(platform.ns_window().cast());
    });
}
