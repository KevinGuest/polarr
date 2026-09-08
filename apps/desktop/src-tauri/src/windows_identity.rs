//! Windows process / audio identity for Polarr Desktop.
//!
//! WebView2 audio often appears in the volume mixer as "MSEDGEWEBVIEW2".
//! We register an explicit AppUserModelID (matching the bundle identifier
//! stamped on NSIS shortcuts) and best-effort rename audio sessions that
//! still advertise WebView2 to "Polarr".

#![cfg(windows)]

use std::time::Duration;

/// Must match `tauri.conf.json` `identifier` so the running process groups
/// with the installer Start Menu / Desktop shortcuts.
pub const APP_USER_MODEL_ID: &str = "app.polarr.desktop";

/// Call before any window / WebView is created.
pub fn set_process_aumid() {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    let id = HSTRING::from(APP_USER_MODEL_ID);
    if let Err(err) = unsafe { SetCurrentProcessExplicitAppUserModelID(&id) } {
        eprintln!("polarr: SetCurrentProcessExplicitAppUserModelID failed: {err}");
    }
}

/// Periodically rename WebView2 audio sessions to "Polarr" in the volume mixer.
pub fn spawn_audio_session_relabeler() {
    std::thread::Builder::new()
        .name("polarr-audio-identity".into())
        .spawn(|| {
            // Give WebView2 time to create its first session after launch.
            std::thread::sleep(Duration::from_secs(2));
            loop {
                let _ = relabel_webview_sessions();
                std::thread::sleep(Duration::from_secs(4));
            }
        })
        .ok();
}

fn relabel_webview_sessions() -> windows::core::Result<()> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioSessionControl, IAudioSessionControl2,
        IAudioSessionEnumerator, IAudioSessionManager2, IMMDeviceEnumerator,
        MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        let com_ok = hr.is_ok() || hr == windows::core::HRESULT(0x80010106u32 as i32); // RPC_E_CHANGED_MODE
        if !com_ok {
            return Err(windows::core::Error::from(hr));
        }

        let result = (|| -> windows::core::Result<()> {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
            let session_manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
            let sessions: IAudioSessionEnumerator = session_manager.GetSessionEnumerator()?;
            let count = sessions.GetCount()?;

            for i in 0..count {
                let control: IAudioSessionControl = match sessions.GetSession(i) {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                let display = control
                    .GetDisplayName()
                    .ok()
                    .and_then(|p| p.to_string().ok())
                    .unwrap_or_default();

                let mut looks_webview = display.to_ascii_lowercase().contains("webview");

                if let Ok(control2) = control.cast::<IAudioSessionControl2>() {
                    if let Ok(exe) = control2.GetSessionInstanceIdentifier() {
                        if let Ok(s) = exe.to_string() {
                            let lower = s.to_ascii_lowercase();
                            if lower.contains("msedgewebview2") || lower.contains("webview2") {
                                looks_webview = true;
                            }
                        }
                    }
                }

                if !looks_webview || display.eq_ignore_ascii_case("Polarr") {
                    continue;
                }

                let _ = control.SetDisplayName(PCWSTR::from_raw(windows::core::w!("Polarr").as_ptr()), None);
            }
            Ok(())
        })();

        if hr.is_ok() {
            CoUninitialize();
        }
        result
    }
}
