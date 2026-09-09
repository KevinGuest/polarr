# iOS native playback (PolarrPlayer)

Spotify-shaped split: **one native decode engine**, many UIs.

## Ownership

| Layer | Owns |
| --- | --- |
| `PolarrPlayerPlugin` (Swift / AVPlayer) | Decode, `AVAudioSession`, Now Playing metadata, remote commands (play/pause/seek/next/prev events) |
| `player-provider.tsx` (JS) | Queue, shuffle, taste autoplay, Connect, stream URL + media tickets + `compat=1`, karaoke/EQ (HTML path only for now) |
| CarPlay (planned) | Templates that command the same native player |

## Flow

```
Phone UI / Lock Screen / (future CarPlay)
        │
        ▼
  PolarrPlayer.load|play|pause|seek
        │
        ▼
     AVPlayer  ──► speakers / A2DP / CarPlay audio route
        │
        └── events ──► JS (timeupdate, ended, remote next/prev)
```

JS builds the final playable URL (`audioSrcFor`) and passes it to `load`. Native does not re-implement tickets or FLAC compat.

## Out of v1

- Gapless / crossfade second bus
- Karaoke instrumental mix + WebAudio EQ on the native path
- CarPlay browse templates + entitlement
- Desktop native player (still HTMLAudio / Tauri)

## Files

- `apps/mobile/ios/App/App/PolarrPlayerPlugin.swift`
- `src/lib/ios-player.ts`
- Wiring in `src/components/player-provider.tsx`
