# syntax=docker/dockerfile:1.7

# Fast, cache-friendly multi-stage image for Umbrel / GHCR.
# Prefer better-sqlite3 prebuilds (no compile) unless a platform lacks them.

ARG NODE_VERSION=22-bookworm-slim

# ── dependencies (cached unless package-lock changes) ────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    npm_config_build_from_source=false

# Native compile toolchain only as fallback if prebuilds are missing for the arch.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

# ── next build (invalidates only when app source changes) ────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs components.json ./
COPY public ./public
COPY src ./src

RUN npm run build \
  && npm prune --omit=dev

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    POLARR_DATA_DIR=/data \
    POLARR_MUSIC_DIR=/music \
    POLARR_DOWNLOADS_DIR=/music/downloads

# Pin yt-dlp so this layer stays cacheable across builds.
ARG YT_DLP_VERSION=2026.07.04

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
  && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp" \
       -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && groupadd --system --gid 1000 polarr \
  && useradd --system --uid 1000 --gid 1000 --home-dir /app --shell /usr/sbin/nologin polarr \
  && mkdir -p /data /music \
  && chown -R polarr:polarr /data /music /app \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=polarr:polarr /app/public ./public
COPY --from=builder --chown=polarr:polarr /app/.next/standalone ./
COPY --from=builder --chown=polarr:polarr /app/.next/static ./.next/static
# Ensure native SQLite binary is present for standalone server
COPY --from=builder --chown=polarr:polarr /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=polarr:polarr /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=polarr:polarr /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

USER polarr
EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/v1/status" || exit 1

CMD ["node", "server.js"]
