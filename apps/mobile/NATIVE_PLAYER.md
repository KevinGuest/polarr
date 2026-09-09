# iOS native playback (PolarrPlayer)

Spotify-shaped split: **one native decode engine**, many UIs.

## Ownership

| Layer | Owns |
| --- | --- |
| `PolarrPlayerPlugin` (Swift / AVPlayer) | Decode, `AVAudioSession`, Now Playing metadata, remote commands, CarPlay browse cache |
| `player-provider.tsx` (JS) | Queue, shuffle, taste autoplay, Connect, stream URL + media tickets + `compat=1`, karaoke/EQ (HTML path only for now) |
| `CarPlaySceneDelegate` | CarPlay templates commanding the same player |

## Flow

```
Phone UI / Lock Screen / CarPlay
        │
        ▼
  PolarrPlayer.load|play|pause|seek|syncBrowse
        │
        ▼
     AVPlayer  ──► speakers / A2DP / CarPlay audio route
        │
        └── events ──► JS (timeupdate, ended, remote, trackchange)
```

JS builds the final playable URL (`audioSrcFor`) and passes it to `load` / `syncBrowse`. Native does not re-implement tickets or FLAC compat.

## Out of v1

- Gapless / crossfade second bus
- Karaoke instrumental mix + WebAudio EQ on the native path
- Full CarPlay library browser (search / Made For) — Queue + Now Playing first
- Desktop native player (still HTMLAudio / Tauri)

## Files

- `apps/mobile/ios/App/App/PolarrPlayerPlugin.swift`
- `apps/mobile/ios/App/App/CarPlaySceneDelegate.swift`
- `src/lib/ios-player.ts`
- Wiring in `src/components/player-provider.tsx`
- See also `CARPLAY.md`
