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
//!
//! `with_webview` requires `Send + 'static` closures, so NSWindow pointers are
//! carried as `usize` (raw `*mut c_void` is not `Send`).

use std::ffi::c_void;

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

fn ns_window_addr(app: &AppHandle) -> Option<usize> {
    let window = app.get_window("main")?;
    window.ns_window().ok().map(|ptr| ptr as usize)
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
    let Some(ns) = ns_window_addr(app) else {
        return;
    };
    let Some(shell) = app.get_webview("main") else {
        return;
    };
    let server = app.get_webview(SERVER_WEBVIEW_LABEL);

    if let Some(server) = server {
        let _ = shell.with_webview(move |shell_platform| {
            let shell_addr = shell_platform.inner() as usize;
            let _ = server.with_webview(move |server_platform| unsafe {
                polarr_macos_align_traffic_lights(ns as *mut c_void);
                polarr_macos_layout_webviews(
                    ns as *mut c_void,
                    shell_addr as *mut c_void,
                    server_platform.inner().cast(),
                    TITLEBAR_HEIGHT,
                );
            });
        });
    } else {
        let _ = shell.with_webview(move |shell_platform| unsafe {
            polarr_macos_align_traffic_lights(ns as *mut c_void);
            polarr_macos_layout_webviews(
                ns as *mut c_void,
                shell_platform.inner().cast(),
                std::ptr::null_mut(),
                TITLEBAR_HEIGHT,
            );
        });
    }
}

pub fn fill_shell(app: &AppHandle) {
    let Some(ns) = ns_window_addr(app) else {
        return;
    };
    let Some(shell) = app.get_webview("main") else {
        return;
    };
    let _ = shell.with_webview(move |platform| unsafe {
        polarr_macos_align_traffic_lights(ns as *mut c_void);
        polarr_macos_fill_shell(ns as *mut c_void, platform.inner().cast());
    });
}
