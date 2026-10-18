/* global self, caches */
/**
 * Polarr audio cache worker.
 *
 * Two tiers, Spotify-style:
 *
 *  1. HEADS  — the first ~15 s (480 KiB of AAC 256k) of tracks you're likely
 *     to tap next: rows on screen, the next few queue items, liked/recent.
 *     When <audio> opens a track we answer its first `bytes=0-` request with
 *     the head from disk, so decoding starts instantly; the element's
 *     follow-up range for the remainder goes to the network and has the head
 *     duration of runway to arrive.
 *
 *  2. FULL   — complete bodies of the last N played tracks (replays start and
 *     seek entirely from disk).
 *
 * Only `/api/stream/*` is intercepted; everything else passes through.
 */

const CACHE = "polarr-audio-v2";
const LEGACY_CACHES = ["polarr-audio-v1"];
const FULL_INDEX = "/__polarr/audio-index";
const HEAD_INDEX = "/__polarr/head-index";
const HEAD_PREFIX = "/__polarr/head?u=";

const MAX_FULL_TRACKS = 40;
const MAX_FULL_TRACK_BYTES = 160 * 1024 * 1024;
/** ~15 s of AAC-LC 256 kbps (incl. moov). Raw FLAC heads are shorter but still useful. */
const HEAD_BYTES = 480 * 1024;
const MAX_HEADS = 800; // ≈ 375 MB
const HEAD_FETCH_CONCURRENCY = 3;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of LEGACY_CACHES) {
        try {
          await caches.delete(name);
        } catch {
          /* ignore */
        }
      }
      await self.clients.claim();
    })(),
  );
});

/** Stable key: drop rotating auth tickets, keep quality/compat params. */
function keyFor(url) {
  const u = new URL(url, self.location.origin);
  u.searchParams.delete("mediaTicket");
  u.hash = "";
  const params = Array.from(u.searchParams.entries()).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const q = new URLSearchParams(params).toString();
  return `${u.origin}${u.pathname}${q ? `?${q}` : ""}`;
}

function headKeyFor(key) {
  return `${self.location.origin}${HEAD_PREFIX}${encodeURIComponent(key)}`;
}

function isStreamUrl(url) {
  return (
    url.origin === self.location.origin &&
    url.pathname.startsWith("/api/stream/") &&
    url.searchParams.get("download") !== "1"
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (!isStreamUrl(url)) return;
  event.respondWith(serveStream(req));
});

function parseRange(header) {
  if (!header) return null;
  const m = /bytes=(\d*)-(\d*)/.exec(header);
  if (!m) return null;
  return {
    start: m[1] ? Number(m[1]) : NaN,
    end: m[2] ? Number(m[2]) : NaN,
  };
}

async function serveStream(req) {
  let cache;
  try {
    cache = await caches.open(CACHE);
  } catch {
    return fetch(req);
  }
  const key = keyFor(req.url);
  const range = parseRange(req.headers.get("range"));

  // Full body on disk → serve any range locally.
  const full = await cache.match(key);
  if (full) {
    touch(cache, FULL_INDEX, key).catch(() => {});
    try {
      return await rangeFromFull(full, range);
    } catch {
      return fetch(req);
    }
  }

  // Head on disk and the request starts inside it → answer with the head
  // slice. <audio> will come back with `bytes=<headEnd+1>-` for the rest.
  if (!range || (Number.isFinite(range.start) && range.start < HEAD_BYTES)) {
    const head = await cache.match(headKeyFor(key));
    if (head) {
      try {
        const res = await rangeFromHead(head, range);
        if (res) {
          touch(cache, HEAD_INDEX, key).catch(() => {});
          return res;
        }
      } catch {
        /* fall through */
      }
    }
  }
  return fetch(req);
}

function baseHeaders(src) {
  const h = {
    "Content-Type": src.headers.get("Content-Type") || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400, immutable",
    "X-Polarr-Cache": "hit",
  };
  const q = src.headers.get("X-Polarr-Stream-Quality");
  if (q) h["X-Polarr-Stream-Quality"] = q;
  return h;
}

async function rangeFromFull(full, range) {
  const blob = await full.blob();
  const size = blob.size;
  const base = baseHeaders(full);
  if (!range) {
    return new Response(blob, {
      status: 200,
      headers: { ...base, "Content-Length": String(size) },
    });
  }
  let { start, end } = range;
  if (Number.isNaN(start)) {
    start = Math.max(0, size - end); // suffix: bytes=-N
    end = size - 1;
  }
  if (Number.isNaN(end)) end = size - 1;
  if (start < 0 || start >= size) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }
  end = Math.min(end, size - 1);
  return new Response(blob.slice(start, end + 1, base["Content-Type"]), {
    status: 206,
    headers: {
      ...base,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

/**
 * Head entry: body = first HEAD_BYTES bytes, header X-Polarr-Total = full size.
 * Always answers 206 (even for an un-ranged GET) so the element knows there's
 * more and fetches the remainder itself.
 */
async function rangeFromHead(head, range) {
  const total = Number(head.headers.get("X-Polarr-Total") || 0);
  if (!total) return null;
  const blob = await head.blob();
  const headLen = blob.size;
  const base = baseHeaders(head);
  const start = range && Number.isFinite(range.start) ? range.start : 0;
  if (start >= headLen) return null;
  let end = range && Number.isFinite(range.end) ? range.end : headLen - 1;
  end = Math.min(end, headLen - 1, total - 1);
  if (end < start) return null;
  return new Response(blob.slice(start, end + 1, base["Content-Type"]), {
    status: 206,
    headers: {
      ...base,
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

/* ───────────────────────────── LRU indexes ───────────────────────────── */

async function readIndex(cache, indexUrl) {
  try {
    const res = await cache.match(indexUrl);
    if (!res) return [];
    const arr = await res.json();
    return Array.isArray(arr) ? arr.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

async function writeIndex(cache, indexUrl, index) {
  await cache.put(
    indexUrl,
    new Response(JSON.stringify(index), {
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// Serialise index mutations — concurrent head fetches would otherwise race.
let indexLock = Promise.resolve();
function withIndexLock(fn) {
  const run = indexLock.then(fn, fn);
  indexLock = run.catch(() => {});
  return run;
}

function touch(cache, indexUrl, key) {
  return withIndexLock(async () => {
    const index = await readIndex(cache, indexUrl);
    const i = index.indexOf(key);
    if (i >= 0) index.splice(i, 1);
    index.push(key);
    await writeIndex(cache, indexUrl, index);
  });
}

function trim(cache, indexUrl, max, toCacheKey) {
  return withIndexLock(async () => {
    const index = await readIndex(cache, indexUrl);
    while (index.length > max) {
      const victim = index.shift();
      if (victim) await cache.delete(toCacheKey(victim)).catch(() => {});
    }
    await writeIndex(cache, indexUrl, index);
  });
}

/* ───────────────────────────── messages ───────────────────────────── */

const inflightFull = new Set();
const inflightHead = new Set();
const headQueue = [];
let headWorkers = 0;

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  switch (data.type) {
    case "cache-track":
      if (typeof data.url === "string") event.waitUntil(cacheFull(data.url));
      break;
    case "cache-heads":
      if (Array.isArray(data.urls)) {
        event.waitUntil(enqueueHeads(data.urls.filter((u) => typeof u === "string")));
      }
      break;
    case "clear":
      event.waitUntil(caches.delete(CACHE));
      break;
    case "stats":
      event.waitUntil(
        (async () => {
          const cache = await caches.open(CACHE);
          const full = await readIndex(cache, FULL_INDEX);
          const heads = await readIndex(cache, HEAD_INDEX);
          event.source?.postMessage({
            type: "stats",
            full: full.length,
            heads: heads.length,
          });
        })(),
      );
      break;
    default:
      break;
  }
}

/** Complete body for replays. */
async function cacheFull(url) {
  let parsed;
  try {
    parsed = new URL(url, self.location.origin);
  } catch {
    return;
  }
  if (!isStreamUrl(parsed)) return;
  const key = keyFor(url);
  if (inflightFull.has(key)) return;
  inflightFull.add(key);
  try {
    const cache = await caches.open(CACHE);
    if (await cache.match(key)) {
      await touch(cache, FULL_INDEX, key);
      return;
    }
    const res = await fetch(parsed.toString(), {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok || res.status !== 200) return;
    const len = Number(res.headers.get("Content-Length") || 0);
    if (len > MAX_FULL_TRACK_BYTES) return;
    const type = res.headers.get("Content-Type") || "";
    if (!/^audio\//i.test(type) && type !== "application/octet-stream") return;
    await cache.put(key, res);
    await touch(cache, FULL_INDEX, key);
    await trim(cache, FULL_INDEX, MAX_FULL_TRACKS, (k) => k);
    // Head is redundant once the full body exists.
    await cache.delete(headKeyFor(key)).catch(() => {});
  } catch {
    /* network / quota — best effort */
  } finally {
    inflightFull.delete(key);
  }
}

/** Queue heads; most recently requested first (what's on screen now wins). */
async function enqueueHeads(urls) {
  const cache = await caches.open(CACHE);
  for (const url of urls.slice().reverse()) {
    let parsed;
    try {
      parsed = new URL(url, self.location.origin);
    } catch {
      continue;
    }
    if (!isStreamUrl(parsed)) continue;
    const key = keyFor(url);
    if (inflightHead.has(key)) continue;
    if (await cache.match(key)) continue; // full body already there
    if (await cache.match(headKeyFor(key))) {
      touch(cache, HEAD_INDEX, key).catch(() => {});
      continue;
    }
    const i = headQueue.findIndex((item) => item.key === key);
    if (i >= 0) headQueue.splice(i, 1);
    headQueue.unshift({ key, url: parsed.toString() });
  }
  while (headQueue.length > MAX_HEADS) headQueue.pop();
  while (headWorkers < HEAD_FETCH_CONCURRENCY && headQueue.length) {
    headWorkers += 1;
    void headWorker().finally(() => {
      headWorkers -= 1;
    });
  }
}

async function headWorker() {
  while (headQueue.length) {
    const item = headQueue.shift();
    if (!item || inflightHead.has(item.key)) continue;
    inflightHead.add(item.key);
    try {
      await fetchHead(item.key, item.url);
    } catch {
      /* ignore */
    } finally {
      inflightHead.delete(item.key);
    }
  }
}

async function fetchHead(key, url) {
  const cache = await caches.open(CACHE);
  if (await cache.match(key)) return;
  if (await cache.match(headKeyFor(key))) return;
  const res = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
  });
  if (!res.ok) return;
  let total = 0;
  let body;
  if (res.status === 206) {
    const m = /bytes \d+-\d+\/(\d+)/.exec(res.headers.get("Content-Range") || "");
    total = m ? Number(m[1]) : 0;
    body = await res.blob();
  } else if (res.status === 200) {
    // Server ignored Range (shouldn't for library files) — keep only the head.
    const whole = await res.blob();
    total = whole.size;
    body = whole.slice(0, HEAD_BYTES, whole.type);
  } else {
    return;
  }
  if (!total || !body || body.size === 0) return;
  const headers = {
    "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
    "X-Polarr-Total": String(total),
  };
  const q = res.headers.get("X-Polarr-Stream-Quality");
  if (q) headers["X-Polarr-Stream-Quality"] = q;
  await cache.put(headKeyFor(key), new Response(body, { status: 200, headers }));
  await touch(cache, HEAD_INDEX, key);
  await trim(cache, HEAD_INDEX, MAX_HEADS, headKeyFor);
}
