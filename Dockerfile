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
# Use arch-specific standalone binaries (zipapp needs Python, which we skip).
ARG YT_DLP_VERSION=2026.07.04
ARG TARGETARCH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg gosu \
  && case "${TARGETARCH}" in \
       amd64) YT_ASSET=yt-dlp_linux ;; \
       arm64) YT_ASSET=yt-dlp_linux_aarch64 ;; \
       *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${YT_ASSET}" \
       -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && /usr/local/bin/yt-dlp --version \
  && which ffmpeg \
  && mkdir -p /data /music \
  && chown -R node:node /data /music /app \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# Native modules used by the app (sqlite) + karaoke HT-Demucs stack.
# Next standalone tracing omits these; onnxruntime-node also needs
# onnxruntime-common at the top level or Demucs fails with MODULE_NOT_FOUND.
COPY --from=builder --chown=node:node /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=node:node /app/node_modules /tmp/nm
RUN set -eux; \
    mkdir -p node_modules; \
    for pkg in \
      bindings \
      file-uri-to-path \
      demucs \
      mediabunny \
      onnxruntime-node \
      onnxruntime-common \
    ; do \
      if [ -d "/tmp/nm/$pkg" ]; then cp -a "/tmp/nm/$pkg" node_modules/; fi; \
    done; \
    if [ -d "/tmp/nm/@mediabunny" ]; then cp -a "/tmp/nm/@mediabunny" node_modules/; fi; \
    # Fail the image if karaoke ORT cannot load (missing common / native bin).
    node -e "require('onnxruntime-common'); require('onnxruntime-node'); console.log('karaoke ort ok')"; \
    test -f node_modules/demucs/dist/cli.js; \
    test -f node_modules/demucs/htdemucs.onnx; \
    chown -R node:node node_modules; \
    rm -rf /tmp/nm

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
  && chmod a+rx /usr/local/bin/docker-entrypoint.sh

# Start as root so entrypoint can chown bind mounts, then drop to node.
EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/v1/status" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
