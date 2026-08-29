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
//! `set_theme` / `set_title` reset AppKit's traffic-light frames, so we re-apply
//! the inset after those calls and on every resize. Child server webviews are
//! also framed in Objective-C: overlay windows ignore some wry `set_size` calls,
//! which left a full-size shell covering the server view (black after Connect).

use std::ffi::c_void;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, Webview};

use super::server_webview::{SERVER_WEBVIEW_LABEL, TITLEBAR_HEIGHT};

extern "C" {
    fn polarr_macos_paint_window(ns_window: *mut c_void);
    fn polarr_macos_paint_webview(wk_webview: *mut c_void);
    fn polarr_macos_align_traffic_lights(ns_window: *mut c_void);
    fn polarr_macos_layout_webviews(
        ns_window: *mut c_void,
        shell_wv: *mut c_void,
        server_wv: *mut c_void,
        titlebar_h: f64,
    );
    fn polarr_macos_fill_shell(ns_window: *mut c_void, shell_wv: *mut c_void);
}

fn wk_ptr(wv: &Webview) -> *mut c_void {
    let slot = Arc::new(Mutex::new(std::ptr::null_mut()));
    let captured = slot.clone();
    let _ = wv.with_webview(move |platform| {
        *captured.lock().expect("wk ptr") = platform.inner().cast();
    });
    *slot.lock().expect("wk ptr")
}

pub fn apply(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let _ = window.set_theme(Some(tauri::Theme::Dark));
    let _ = window.set_shadow(true);
    // Overlay is already set in tauri.conf.json. Calling set_title_bar_style
    // again resets trafficLightPosition, so we only re-align in Objective-C.
    if let Ok(ptr) = window.ns_window() {
        unsafe {
            polarr_macos_paint_window(ptr);
            polarr_macos_align_traffic_lights(ptr);
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

pub fn align_traffic_lights(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    if let Ok(ptr) = window.ns_window() {
        unsafe {
            polarr_macos_align_traffic_lights(ptr);
        }
    }
}

/// Pin the shell to the 48px title bar and put the server view under it.
pub fn layout_connected(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let Some(shell) = app.get_webview("main") else {
        return;
    };
    let shell_ptr = wk_ptr(&shell);
    if shell_ptr.is_null() {
        return;
    }
    let server_ptr = app
        .get_webview(SERVER_WEBVIEW_LABEL)
        .map(|wv| wk_ptr(&wv))
        .filter(|p| !p.is_null())
        .unwrap_or(std::ptr::null_mut());
    unsafe {
        polarr_macos_align_traffic_lights(ns_window);
        polarr_macos_layout_webviews(ns_window, shell_ptr, server_ptr, TITLEBAR_HEIGHT);
    }
}

pub fn fill_shell(app: &AppHandle) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let Some(shell) = app.get_webview("main") else {
        return;
    };
    let shell_ptr = wk_ptr(&shell);
    if shell_ptr.is_null() {
        return;
    }
    unsafe {
        polarr_macos_align_traffic_lights(ns_window);
        polarr_macos_fill_shell(ns_window, shell_ptr);
    }
}
