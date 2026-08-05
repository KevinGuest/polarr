# Polarr — self-hosted music discovery, requests, and streaming

Polarr is a homeserver music hub: point it at [Lidarr](https://github.com/Lidarr/Lidarr) (same pattern as [Seerr](https://docs.seerr.dev/) → Sonarr/Radarr), request missing music, optionally fall back to a [Downtify](https://github.com/henriquesebastiao/downtify)-inspired yt-dlp acquirer, and stream from the web UI or the Expo iOS companion for offline listening.

Packaging targets the [Umbrel App Store](https://github.com/getumbrel/umbrel-apps) model: browser first-run, Docker runtime, persisted volumes, no SSH setup.

## Stack

| Layer | Choice |
| --- | --- |
| Web + API | Next.js (App Router) |
| UI | shadcn-style components + Tailwind |
| Config / library DB | SQLite (`better-sqlite3`, WAL) — tracks, requests lifecycle, downloads, events |
| Music manager | Lidarr API |
| Fallback acquire | yt-dlp + ffmpeg (container includes both) |
| Mobile | Expo (React Native) under `ios/` |
| Umbrel host port | **3647** (unused across the official store at scaffold time) |

## Local dev

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Complete the setup wizard (admin account + optional Lidarr URL/API key).

Fallback (Downtify-style) downloads land under `POLARR_DOWNLOADS_DIR` and are **streamable by default** once the file is on disk — no extra import step.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `POLARR_DATA_DIR` | `./data` | SQLite + app state |
| `POLARR_MUSIC_DIR` | `./music` | Library root to scan |
| `POLARR_DOWNLOADS_DIR` | `./music/downloads` | Fallback download output |

Optional: install [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg for fallback acquisition outside Docker.

## Docker (local)

```bash
docker compose up --build
# or with BuildKit local cache (faster rebuilds):
npm run docker:build:fast
```

App: [http://localhost:3647](http://localhost:3647)  
Health: [http://localhost:3647/api/v1/status](http://localhost:3647/api/v1/status)

Production images publish from **[polarr-app](https://github.com/KevinGuest/polarr-app)** as `ghcr.io/kevinguest/polarr-app`.

Image build notes (kept fast on purpose):

- Multi-stage + `npm` layer cache; source `COPY` only `src/` + config (not `ios/`)
- Prefer `better-sqlite3` prebuilds (`npm_config_build_from_source=false`)
- Standalone Next output (small runtime image)
- Pinned `yt-dlp` release (cacheable layer)
- GH Actions (`.github/workflows/docker.yml`): GHA cache, PR = `amd64` only, `main`/tags = `amd64`+`arm64`

## Umbrel package

Draft package lives in `umbrel-package/polarr/`:

- `umbrel-app.yml` — manifest (`port: 3647`, dependency on `lidarr`, `STORAGE_DOWNLOADS`)
- `docker-compose.yml` — `app_proxy` → web on internal `3000`, music mount under shared Downloads

Before a store PR:

1. Publish multi-arch images from [polarr-app](https://github.com/KevinGuest/polarr-app) (`ghcr.io/kevinguest/polarr-app`)
2. Pin the image digest in the Umbrel compose file
3. Follow skills from [umbrel-apps](https://github.com/getumbrel/umbrel-apps): develop → package → test
4. Galleries are left empty; Umbrel team supplies assets

Suggested Umbrel Lidarr URL during setup: `http://lidarr_server_1:8686`

API paths are whitelisted through `app_proxy` (`/api/*`) so the iOS app can authenticate with bearer tokens without Umbrel cookies.

## Mobile companion

```bash
cd ios
npm install
npx expo start
```

Flow: Connect → server URL (e.g. `http://<umbrel-ip>:3647`) → login → library play/offline download via byte-range `/api/stream/:id`.

## API surface (clients)

- `GET /api/v1/status` — health (no secrets)
- `POST /api/auth/login` — session token
- `GET /api/library` / `POST` scan
- `GET /api/search?q=`
- `POST /api/requests` — Lidarr + optional fallback
- `GET /api/stream/:id` — range-aware audio
- `GET|POST /api/settings`

## License note

Fallback downloading uses tools that can touch third-party content. Users are responsible for complying with copyright and provider terms in their jurisdiction. Polarr is intended for legitimate self-hosted library management and streaming of music you are allowed to use.
