# CarPlay (audio)

Polarr is a **CarPlay Audio** app on top of the native `PolarrPlayer` AVPlayer.

CarPlay is a **player extension only** — Now Playing + queue. Sign-in happens on
iPhone; if there is no session, CarPlay shows “Sign in on iPhone”.

## What ships in code

| Piece | Role |
| --- | --- |
| `App.entitlements` | `com.apple.developer.carplay-audio` (Apple-approved) |
| `Info.plist` scene manifest | Phone `UIWindowScene` → `SceneDelegate` **and** `CPTemplateApplicationScene` → `CarPlaySceneDelegate` |
| `SceneDelegate` | Loads Main storyboard so Capacitor does not black-screen |
| `CarPlaySceneDelegate` | Sign-in gate, then Now Playing + Queue tabs |
| `PolarrOffline.setSignedIn` / `setSession` | Persist auth for CarPlay when JS logs in/out |
| `PolarrPlayer.syncBrowse` | JS pushes upcoming queue (URLs already ticketed) so CarPlay next/prev works while WKWebView is suspended |

## Why both scenes

Adding **only** a CarPlay scene makes newer iOS skip the storyboard window path → **black screen on launch**. Always ship:

1. `UIWindowSceneSessionRoleApplication` → `SceneDelegate` (phone UI)
2. `CPTemplateApplicationSceneSessionRoleApplication` → `CarPlaySceneDelegate`

## Apple entitlement

CarPlay Audio is enabled on team `C7Z88WS83P` / App ID `app.polarr.mobile`. Regenerate the provisioning profile if signing fails, then confirm Xcode Automatic Signing picks a profile that includes CarPlay Audio.

## Test plan

1. Build to device, **sign in** on iPhone, play a queue in Polarr.
2. Connect CarPlay (car or Simulator → I/O → External Displays → CarPlay).
3. Polarr → Playing / Queue; next/prev from the wheel while the phone is locked.
4. Sign out on iPhone → CarPlay should switch to “Sign in on iPhone”.
5. Cold-launch the phone app — UI must appear (not a black screen).

## Files

- `apps/mobile/ios/App/App/SceneDelegate.swift`
- `apps/mobile/ios/App/App/CarPlaySceneDelegate.swift`
- `apps/mobile/ios/App/App/App.entitlements`
- `apps/mobile/ios/App/App/PolarrOfflinePlugin.swift`
- `apps/mobile/ios/App/App/PolarrPlayerPlugin.swift` (`syncBrowse`, browse advance)
- `src/lib/ios-player.ts` / `native-client.ts` / `player-provider.tsx`
