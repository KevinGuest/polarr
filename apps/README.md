# Polarr native clients

Thin shells around your self-hosted Polarr web UI (same model as Plex/Jellyfin clients). The Next.js server remains the source of truth — these apps only store a **Server URL**, then load that origin in a native WebView so session cookies (`polarr_token`) and `/api/stream/…` playback work as in the browser.

| App | Stack | Path |
| --- | --- | --- |
| Windows desktop | Tauri 2 + WebView2 | `apps/desktop` |
| macOS desktop | Tauri 2 + WKWebView | `apps/desktop` (same shell) |
| iOS | Capacitor 7 + WKWebView | `apps/mobile` (+ `ios/`) |

Docker / Umbrel builds ignore `apps/` — the server image is unchanged.

## Prerequisites

### Windows (Tauri)

1. [Node.js](https://nodejs.org/) 20+
2. [Rust](https://rustup.rs/) — put `%USERPROFILE%\.cargo\bin` on `PATH`
3. [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** (provides `link.exe`)
4. WebView2 Runtime (usually already on Windows 10/11)

If `link.exe` is missing in a normal terminal, use **Developer PowerShell for VS**, or run `vcvars64.bat` first (typical path:  
`C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat`).

### macOS (Tauri)

1. [Node.js](https://nodejs.org/) 20+
2. [Rust](https://rustup.rs/)
3. Xcode 15+ (Command Line Tools: `xcode-select --install`)

## Windows — run / build

```bash
cd apps/desktop
npm install
npm run tauri:dev      # setup UI → connect → loads your Polarr URL
npm run tauri:build    # NSIS/MSI under src-tauri/target/release/bundle/
```

### Ship the installer (download artifact)

**Offer the NSIS setup.exe as the public download** — not the raw `.exe` from `target/release/`. The NSIS installer uses custom Polarr branding (dark left sidebar + header bitmaps, app icon) on stock light MUI chrome; the MSI is an optional enterprise fallback with matching WiX art (dark brand strip on the left of the dialog bitmap, light text field on the right).

After a successful release build:

| Artifact | Path |
| --- | --- |
| **NSIS installer (ship this)** | `apps/desktop/src-tauri/target/release/bundle/nsis/Polarr_0.2.2_x64-setup.exe` |
| MSI (optional / enterprise) | `apps/desktop/src-tauri/target/release/bundle/msi/Polarr_0.2.2_x64_en-US.msi` |
| Unpackaged binary | `apps/desktop/src-tauri/target/release/polarr-desktop.exe` |

Installer metadata (product name **Polarr**, publisher **Polarr**, version from `tauri.conf.json` / package) and the app icon (`icons/icon.ico`) are wired for Start Menu / desktop shortcuts. NSIS/WiX bitmaps live in `src-tauri/installer-assets/` (regenerate with `npm run installer-assets` after changing `public/polarr-icon.png` or theme colors in `scripts/generate-installer-assets.ps1`). Bitmaps are **24-bit BMP** at stock sizes (NSIS sidebar 164×314, header 150×57; WiX dialog 493×312 with branding only in the left ~164px, banner 493×58). Do not full-bleed dark art under wizard text — MUI/WiX draw dark copy on the light panel.

Regenerate icons from the brand mark whenever `public/polarr-icon.png` changes:

```bash
cd apps/desktop
npm run icons          # ≡ npx tauri icon public/polarr-icon.png
npm run installer-assets   # MUI/WiX-safe Polarr bitmaps from polarr-icon.png
npm run tauri:build    # rebuild so installer/taskbar pick up new icons
```

The Windows shell is **frameless** (custom dark title bar, rounded corners via window shadow on Windows 11, min/max/close controls). The title bar stays mounted while Polarr loads in an embedded frame below it — navigating to your server URL does not replace the chrome.

First launch asks for a Server URL (example: `http://192.168.1.10:3647`). It is saved under the app config dir. Use the **⋯** menu in the title bar → **Change Server…** to wipe it and return to setup. **⋯ → Downloads** lists offline cached tracks.

## macOS — run / build

On a Mac:

```bash
cd apps/desktop
npm install
npm run tauri:dev
npm run tauri:build
# universal (Intel + Apple Silicon) — recommended for distribution:
npm run tauri -- build --target universal-apple-darwin
```

After a release build:

| Artifact | Path |
| --- | --- |
| **DMG (ship this)** | `src-tauri/target/universal-apple-darwin/release/bundle/dmg/Polarr_0.2.2_universal.dmg` |
| App bundle | `src-tauri/target/universal-apple-darwin/release/bundle/macos/Polarr.app` |

`Info.plist` allows cleartext `http://` to LAN / Umbrel servers (same as iOS). Offline downloads and Discord Rich Presence work the same as Windows.

**Gatekeeper:** Downloaded unsigned builds show *Apple could not verify “Polarr” is free of malware…* Right-click → Open is unreliable on macOS Sequoia+. After copying the app to `/Applications`:

1. **System Settings → Privacy & Security** → **Open Anyway** next to the Polarr blocked message
2. Or: `xattr -cr /Applications/Polarr.app && open /Applications/Polarr.app`

That dialog goes away only for **Developer ID–signed and notarized** builds (see Apple secrets below).

### Ship via GitHub Actions

Push a desktop tag (version comes from `apps/desktop/src-tauri/tauri.conf.json`):

```bash
git tag desktop-v0.2.2
git push origin desktop-v0.2.2
```

Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml) — builds **macOS universal DMG** + **Windows NSIS**, publishes **`latest.json`** for auto-update, and opens a draft GitHub Release.

### Auto-update (GitHub Releases)

The desktop app checks:

`https://github.com/KevinGuest/polarr/releases/latest/download/latest.json`

On launch (after ~4s) and via **⋯ → Check for updates…**. When a newer `desktop-v*` release exists, the menu shows **Update to v…**; Windows installs passively and the app restarts.

**Required GitHub secret** (one-time — keep the private key safe; losing it blocks future updates):

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Full contents of `apps/desktop/.tauri/polarr-updater.key` (generate with `npm run tauri signer generate -- -w .tauri/polarr-updater.key -f --ci -p 'your-password'`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password used when generating the key (empty string if none) |

The **public** key lives in `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). CI signs update bundles; `tauri-action` uploads `latest.json` + `.sig` files to each `desktop-v*` release.

**Important:** Auto-update only works when the GitHub **Latest** release is a desktop release that includes `latest.json`. Web-only tags (`v0.6.x`) should not be published as the Latest GitHub Release unless they also ship desktop updater assets.

**macOS notarization** (required to skip Gatekeeper for GitHub downloads). Enroll in the [Apple Developer Program](https://developer.apple.com/programs/), then create a **Developer ID Application** certificate (not “Apple Development”). CI only enables signing when `APPLE_CERTIFICATE` is non-empty, so missing secrets still produce an unsigned DMG instead of failing the job.

| Secret | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 of the exported `.p12` (`openssl base64 -A -in cert.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | Exact Keychain name, e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | [App-specific password](https://appleid.apple.com) (not your Apple ID password) |
| `APPLE_TEAM_ID` | 10-character Team ID from [Membership](https://developer.apple.com/account) |

After the secrets are set, retag / rerun the **release** workflow. Tauri signs with Hardened Runtime, submits to notarytool, and staples the ticket onto the DMG.

### iOS (Capacitor)

Must be done on a **Mac** with Xcode 16+ and CocoaPods (`sudo gem install cocoapods` or Homebrew). The `ios/` project is already scaffolded here so you can copy the repo to a Mac and open it — you cannot archive/run a simulator from Windows.

## Offline downloads (desktop only)

Spotify-like local cache: library tracks download from your Polarr server into an **encrypted/obfuscated blob** under the app data dir (e.g. `%APPDATA%\app.polarr.desktop\offline\`), playable only through the desktop app while the same user is signed in.

### How it works

1. In the desktop app, right-click a library track → **Download offline** (hidden in normal browsers / Umbrel web).
2. The web UI fetches `/api/stream/{id}` (your session cookies), then hands the bytes to the Tauri shell over a one-shot localhost ingest URL.
3. Rust encrypts with AES-256-GCM; key = SHA-256(`polarr-offline-v1` ‖ device secret ‖ user public id). Metadata (title, artist, album, cover, duration) is stored in `offline/index.json`.
4. Playback prefers `http://polarroffline.localhost/{trackId}` when the track is cached and a session is active.
5. Logout (or Change Server) clears the in-memory session — cached files stay on disk but will not decrypt/play until that user signs in again.

**Threat model:** casual copy protection (files aren’t plain FLAC/MP3 in a browseable folder). Not DRM against someone with a debugger on the same machine.

**⋯ → Downloads** in the title bar lists and removes offline tracks.

### Test offline

1. `npm run tauri:dev` → connect → sign in.
2. Right-click a library track → Download offline → toast success.
3. Open **⋯ → Downloads** and confirm the row appears under `%APPDATA%\app.polarr.desktop\offline\`.
4. Play the track (player should use the local protocol when online or offline).
5. Sign out — playback of that cache should refuse until you sign back in.

## iOS — open on a Mac

On Windows you can still edit/sync web assets:

```bash
cd apps/mobile
npm install
npm run build
npx cap sync ios
```

On a Mac (after cloning):

```bash
cd apps/mobile
npm install
npm run build
npx cap sync ios          # runs pod install
npx cap open ios          # opens App.xcworkspace in Xcode
```

Then select a simulator or device and Run. First launch: enter Server URL → WKWebView navigates to Polarr (cookies stay on that origin).

Already configured in the Xcode project:

- Dark launch / status bar styling
- `UIBackgroundModes = audio` + `AVAudioSession` playback category (background/lock-screen audio when the web player uses HTMLAudio)
- `NSAppTransportSecurity` allows cleartext HTTP for LAN / Umbrel
- Safe-area aware setup screen (`viewport-fit=cover`; Polarr web already sets this)

To change server later: relaunch the app and tap **Change server** during the short “Opening…” pause, or clear the app’s data in iOS Settings.

## Layout

```text
apps/
  README.md                 ← this file
  desktop/                  Tauri shell
    src/                    first-run Server URL UI + offline Downloads panel
    src-tauri/              Rust + window chrome + offline cache + Discord RPC
  mobile/                   Capacitor shell
    src/                    first-run Server URL UI
    ios/                    Xcode project (open on Mac)
```

## Discord Rich Presence

Polarr can show **Listening to Polarr** on Discord (track title, artist, album art, progress bar) while you play music.

### Requirements

1. **Discord desktop** running on the same Windows PC (classic Rich Presence uses local IPC — not Discord in a browser alone).
2. Admin sets a Discord Application **Client ID** under **Admin → Notifications → Rich Presence**. Name the Discord app **Polarr**.
3. User enables **Show listening status** under **Account → Discord**.
4. Prefer the **Polarr desktop app** (`apps/desktop`) — the content webview exposes Tauri IPC so now-playing updates Discord via native Discord IPC. A normal browser tab may also work via Discord’s local WebSocket ports when the origin is allowed.

Album art needs a cover URL Discord’s servers can fetch (typically **https** public/CDN URLs). LAN-only `http://192.168…` covers usually won’t appear; Discord falls back to the app icon.

### Test on Windows

1. Create an application at [discord.com/developers/applications](https://discord.com/developers/applications), name it `Polarr`, copy **Application ID** (Client ID).
2. In Polarr Admin → Notifications → Rich Presence, paste Client ID → Save.
3. Account → Discord → enable **Show listening status**.
4. Start Discord desktop, then:

```bash
cd apps/desktop
npm install
npm run tauri:dev
```

5. Connect to your Polarr server URL, play a track, open your Discord profile → Activity should show **Listening to Polarr** with title / artist / progress.
6. Pause or close Polarr desktop — presence should clear.

OAuth “Link Discord” (Client Secret + redirect URI) is separate and optional; Rich Presence only needs the Client ID.

## Notes

- Auth is unchanged: login happens inside the loaded Polarr site; `polarr_token` is an httpOnly cookie on the server origin.
- Streaming stays relative (`/api/stream/{id}`) on that origin — no separate media backend.
- Offline downloads are desktop-gated (`window.parent` postMessage bridge); Umbrel/web users are unaffected.

## Follow-ups

- Batch / album offline download
- Bandwidth / progress UI in the Downloads panel
- Prefer offline when the server is unreachable (explicit offline mode banner)
