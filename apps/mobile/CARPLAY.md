# CarPlay (audio)

Polarr is a **CarPlay Audio** app on top of the native `PolarrPlayer` AVPlayer.

## What ships in code

| Piece | Role |
| --- | --- |
| `App.entitlements` | `com.apple.developer.carplay-audio` |
| `Info.plist` scene manifest | `CPTemplateApplicationScene` → `CarPlaySceneDelegate` |
| `CarPlaySceneDelegate` | Tab UI: Now Playing + Queue |
| `PolarrPlayer.syncBrowse` | JS pushes upcoming queue (URLs already ticketed) so CarPlay next/prev works while WKWebView is suspended |

Phone UI stays Capacitor + Main storyboard (no phone `UIWindowScene`).

## Apple entitlement (required to appear in CarPlay)

1. Request **CarPlay Audio** at [developer.apple.com/contact/carplay](https://developer.apple.com/contact/carplay/) and sign the CarPlay addendum.
2. When Apple enables the managed capability on team `C7Z88WS83P` / App ID `app.polarr.mobile`, regenerate the provisioning profile so it includes CarPlay Audio.
3. Xcode → Signing: ensure the profile with CarPlay is selected (Automatic usually picks it up after the capability exists).

Without Apple’s grant, the app builds but **will not show on the CarPlay home screen** (Simulator also needs a CarPlay-capable profile).

## Test plan

1. Build **641+** to device, play a queue in Polarr.
2. Connect CarPlay (car or Simulator → I/O → External Displays → CarPlay).
3. Open Polarr → Queue lists upcoming tracks; Playing opens system Now Playing.
4. Next/prev from the car steers wheel / Now Playing while the phone is locked.

## Files

- `apps/mobile/ios/App/App/CarPlaySceneDelegate.swift`
- `apps/mobile/ios/App/App/App.entitlements`
- `apps/mobile/ios/App/App/PolarrPlayerPlugin.swift` (`syncBrowse`, browse advance)
- `src/lib/ios-player.ts` / `player-provider.tsx` browse sync
