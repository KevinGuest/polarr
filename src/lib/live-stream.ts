/**
 * Live (no-download) stream resolution via yt-dlp URL dump.
 * Used when users play a track without queuing a library acquire.
 *
 * Two latency tricks:
 * - Resolved remote URLs persist in SQLite, so a restart doesn't re-pay the
 *   ~3s yt-dlp resolve.
 * - Leading audio bytes are warmed in memory, then served as the head of a
 *   continuous stream so first-byte is instant with no second request.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./db";
import { ensureYtDlp } from "./tools";

const LIVE_UA =
  "Mozilla/5.0 (compatible; Polarr/1.0; +https://github.com/KevinGuest/polarr)";

/** Bytes kept in-process for instant first response. */
const HEAD_BYTES = 512 * 1024;
const LIVE_TTL_MS = 45 * 60 * 1000;
/** googlevideo URLs stay valid ~6h; keep a safety margin. */
const REMOTE_URL_TTL_MS = 4 * 60 * 60 * 1000;

export type LiveEntry = {
  id: string;
  remoteUrl: string;
  title: string;
  artist: string;
  album: string;
  expiresAt: number;
  queryKey: string;
  /** Prefetched leading bytes (always starting at offset 0). */
  head?: Uint8Array | null;
  headTotalSize?: number | null;
  headContentType?: string | null;
  headWarm?: Promise<void> | null;
};

const liveCache = new Map<string, LiveEntry>();
/** artist|title → session id — reuse within TTL (skip next / replay). */
const queryIndex = new Map<string, string>();
const inFlight = new Map<string, Promise<{ id: string; streamUrl: string } | null>>();

function liveQueryKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
}

function cleanupLiveCache() {
  const now = Date.now();
  for (const [id, entry] of liveCache) {
    if (entry.expiresAt <= now) {
      liveCache.delete(id);
      if (queryIndex.get(entry.queryKey) === id) queryIndex.delete(entry.queryKey);
    }
  }
}

/* ── resolved URL persistence ─────────────────────────────────────────────── */

let remoteTableReady = false;

function ensureRemoteTable() {
  if (remoteTableReady) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS live_remote_cache (
      query_key TEXT PRIMARY KEY,
      remote_url TEXT NOT NULL,
      content_type TEXT,
      total_size INTEGER,
      expires_at INTEGER NOT NULL
    );
  `);
  remoteTableReady = true;
}

function readRemoteUrl(queryKey: string): {
  remoteUrl: string;
  contentType: string | null;
  totalSize: number | null;
} | null {
  try {
    ensureRemoteTable();
    const row = getDb()
      .prepare(
        `SELECT remote_url as remoteUrl, content_type as contentType,
                total_size as totalSize, expires_at as expiresAt
         FROM live_remote_cache WHERE query_key = ?`,
      )
      .get(queryKey) as
      | {
          remoteUrl: string;
          contentType: string | null;
          totalSize: number | null;
          expiresAt: number;
        }
      | undefined;
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      getDb()
        .prepare(`DELETE FROM live_remote_cache WHERE query_key = ?`)
        .run(queryKey);
      return null;
    }
    return {
      remoteUrl: row.remoteUrl,
      contentType: row.contentType,
      totalSize: row.totalSize,
    };
  } catch {
    return null;
  }
}

function writeRemoteUrl(entry: LiveEntry) {
  try {
    ensureRemoteTable();
    getDb()
      .prepare(
        `INSERT INTO live_remote_cache(query_key, remote_url, content_type, total_size, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(query_key) DO UPDATE SET
           remote_url = excluded.remote_url,
           content_type = excluded.content_type,
           total_size = excluded.total_size,
           expires_at = excluded.expires_at`,
      )
      .run(
        entry.queryKey,
        entry.remoteUrl,
        entry.headContentType ?? null,
        entry.headTotalSize ?? null,
        Date.now() + REMOTE_URL_TTL_MS,
      );
  } catch {
    /* cache is best-effort */
  }
}

/** Remote URL died (expired / IP mismatch) — force a fresh yt-dlp resolve. */
function dropLiveSession(entry: LiveEntry) {
  liveCache.delete(entry.id);
  if (queryIndex.get(entry.queryKey) === entry.id) {
    queryIndex.delete(entry.queryKey);
  }
  try {
    ensureRemoteTable();
    getDb()
      .prepare(`DELETE FROM live_remote_cache WHERE query_key = ?`)
      .run(entry.queryKey);
  } catch {
    /* ignore */
  }
}

/* ── yt-dlp ───────────────────────────────────────────────────────────────── */

function runYtDlp(ytDlp: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlp, args, {
      shell: false,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString();
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Resolve a remote progressive/audio URL (may expire). */
export async function resolveLiveRemoteUrl(query: string): Promise<string | null> {
  const ytDlp = await ensureYtDlp();
  if (!ytDlp) return null;

  const searchQuery = `ytsearch1:${query.trim()}`;
  const result = await runYtDlp(ytDlp, [
    searchQuery,
    "-g",
    "-f",
    "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout",
    "10",
    "--extractor-args",
    "youtube:player_client=android,web",
  ]);

  if (result.code !== 0) return null;
  const url = result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^https?:\/\//i.test(l));
  return url || null;
}

/* ── serving ──────────────────────────────────────────────────────────────── */

function upstreamHeaders(range?: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "User-Agent": LIVE_UA,
    Accept: "*/*",
  };
  if (range) headers.Range = range;
  return headers;
}

/** YouTube labels audio-only MP4/WebM as video/* — normalize for <audio>. */
function audioContentType(raw: string | null | undefined): string {
  const value = (raw || "").toLowerCase();
  if (value.startsWith("video/mp4")) return "audio/mp4";
  if (value.startsWith("video/webm")) return "audio/webm";
  return raw || "audio/mp4";
}

/** Total object size from Content-Range, or Content-Length on a full 200. */
function parseTotalSize(res: Response): number | null {
  const cr = res.headers.get("content-range");
  const match = cr ? /\/(\d+)\s*$/.exec(cr) : null;
  if (match) return Number(match[1]);
  if (!cr && res.status === 200) {
    const cl = res.headers.get("content-length");
    if (cl) return Number(cl);
  }
  return null;
}

/** Prefetch leading bytes so the first media request is served from memory. */
export function warmLiveHead(entry: LiveEntry): Promise<void> {
  if (entry.head && entry.head.byteLength > 0) return Promise.resolve();
  if (entry.headWarm) return entry.headWarm;

  entry.headWarm = (async () => {
    try {
      const res = await fetch(entry.remoteUrl, {
        headers: upstreamHeaders(`bytes=0-${HEAD_BYTES - 1}`),
      });
      if (!res.ok && res.status !== 206) return;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0) return;
      entry.head = buf;
      entry.headContentType = audioContentType(res.headers.get("content-type"));
      entry.headTotalSize = parseTotalSize(res);
      writeRemoteUrl(entry);
    } catch {
      /* leave uncached — proxy will fetch live */
    } finally {
      entry.headWarm = null;
    }
  })();

  return entry.headWarm;
}

function parseBytesRange(
  rangeHeader: string | null,
): { start: number; end: number | null } | null {
  if (!rangeHeader) return null;
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: match[2] ? Number(match[2]) : null,
  };
}

/**
 * Body that starts with the warmed head bytes and then continues from upstream,
 * so the browser gets byte 0 immediately and keeps streaming in one response.
 */
function headThenUpstream(
  entry: LiveEntry,
  head: Uint8Array,
  start: number,
  end: number,
  signal: AbortSignal | null,
): ReadableStream<Uint8Array> {
  const headEnd = head.byteLength - 1;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const firstEnd = Math.min(end, headEnd);
      controller.enqueue(head.subarray(start, firstEnd + 1));

      if (end <= headEnd) {
        controller.close();
        return;
      }

      const controllerAbort = new AbortController();
      const onAbort = () => controllerAbort.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const res = await fetch(entry.remoteUrl, {
          headers: upstreamHeaders(`bytes=${headEnd + 1}-${end}`),
          signal: controllerAbort.signal,
        });
        if ((res.ok || res.status === 206) && res.body) {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
        }
      } catch {
        /* client went away or upstream died — end the stream */
      } finally {
        signal?.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
}

/** Proxy (or serve warmed head for) a live session, tuned for first-byte latency. */
export async function serveLiveSession(
  entry: LiveEntry,
  req: Request,
): Promise<Response> {
  // A warm started during resolve is usually already done; give it a moment.
  if (!entry.head && entry.headWarm) {
    await Promise.race([
      entry.headWarm,
      new Promise<void>((r) => setTimeout(r, 50)),
    ]);
  }

  const rangeHeader = req.headers.get("range");
  const parsed = parseBytesRange(rangeHeader);
  const start = parsed?.start ?? 0;
  const head = entry.head;
  const total = entry.headTotalSize;
  const contentType = entry.headContentType || "audio/mp4";

  // Fast path: request starts inside the warmed head.
  if (head && head.byteLength > 0 && start < head.byteLength) {
    const bounded = parsed?.end != null;
    const knownTotal = total && Number.isFinite(total) ? total : null;

    // Bounded range fully inside the head — answer straight from memory.
    if (bounded && parsed!.end! <= head.byteLength - 1) {
      const end = parsed!.end!;
      const slice = head.subarray(start, end + 1);
      return new Response(Buffer.from(slice), {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(slice.byteLength),
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store",
          "Content-Range": `bytes ${start}-${end}/${knownTotal ?? "*"}`,
        },
      });
    }

    // Otherwise stream: warmed bytes first, then continue upstream.
    if (knownTotal) {
      const end = bounded
        ? Math.min(parsed!.end!, knownTotal - 1)
        : knownTotal - 1;
      const body = headThenUpstream(entry, head, start, end, req.signal);
      const headers = new Headers({
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
      });
      // No Range header means a plain GET — must answer 200, not 206.
      if (!rangeHeader) {
        return new Response(body, { status: 200, headers });
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${knownTotal}`);
      return new Response(body, { status: 206, headers });
    }
  }

  // Slow path: proxy upstream (mid-file seek, or warm missed).
  let upstream: Response;
  try {
    upstream = await fetch(entry.remoteUrl, {
      headers: upstreamHeaders(rangeHeader),
      signal: req.signal,
    });
  } catch {
    return Response.json({ error: "Upstream stream failed" }, { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    // Expired / IP-bound URL — drop so the client's retry re-resolves.
    if (upstream.status === 403 || upstream.status === 404 || upstream.status === 410) {
      dropLiveSession(entry);
      return Response.json(
        { error: "Live session expired — play again" },
        { status: 410 },
      );
    }
    return Response.json(
      { error: `Upstream returned ${upstream.status}` },
      { status: 502 },
    );
  }

  if (!entry.headContentType) {
    entry.headContentType = audioContentType(upstream.headers.get("content-type"));
  }
  if (!entry.headTotalSize) {
    entry.headTotalSize = parseTotalSize(upstream);
  }

  const out = new Headers();
  out.set("Content-Type", audioContentType(upstream.headers.get("content-type")));
  out.set("Cache-Control", "private, no-store");
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) out.set("Content-Length", contentLength);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) out.set("Content-Range", contentRange);
  out.set("Accept-Ranges", upstream.headers.get("accept-ranges") || "bytes");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

export function getLiveSession(id: string): LiveEntry | null {
  cleanupLiveCache();
  const entry = liveCache.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    liveCache.delete(id);
    if (queryIndex.get(entry.queryKey) === id) queryIndex.delete(entry.queryKey);
    return null;
  }
  return entry;
}

function newSessionId(queryKey: string): string {
  return createHash("sha256")
    .update(`${queryKey}:${randomBytes(6).toString("hex")}`)
    .digest("hex")
    .slice(0, 24);
}

function registerSession(input: {
  queryKey: string;
  remoteUrl: string;
  artist: string;
  title: string;
  album?: string;
  contentType?: string | null;
  totalSize?: number | null;
}): LiveEntry {
  const id = newSessionId(input.queryKey);
  const entry: LiveEntry = {
    id,
    remoteUrl: input.remoteUrl,
    title: input.title,
    artist: input.artist,
    album: input.album || input.title,
    expiresAt: Date.now() + LIVE_TTL_MS,
    queryKey: input.queryKey,
    headContentType: input.contentType ?? null,
    headTotalSize: input.totalSize ?? null,
  };
  liveCache.set(id, entry);
  queryIndex.set(input.queryKey, id);
  return entry;
}

/** Create a short-lived live play session; returns id for /api/live/[id]. */
export async function createLiveSession(input: {
  artist: string;
  title: string;
  album?: string;
}): Promise<{ id: string; streamUrl: string } | null> {
  const query = `${input.artist} ${input.title}`.trim();
  if (!query) return null;

  cleanupLiveCache();
  const qKey = liveQueryKey(input.artist, input.title);

  const existingId = queryIndex.get(qKey);
  if (existingId) {
    const entry = liveCache.get(existingId);
    if (entry && entry.expiresAt > Date.now()) {
      // Warm in the background — never make the caller wait for it.
      void warmLiveHead(entry);
      return {
        id: `live:${existingId}`,
        streamUrl: `/api/live/${existingId}`,
      };
    }
  }

  // Survives restarts: skip the ~3s yt-dlp resolve when the URL is still valid.
  const persisted = readRemoteUrl(qKey);
  if (persisted) {
    const entry = registerSession({
      queryKey: qKey,
      remoteUrl: persisted.remoteUrl,
      artist: input.artist,
      title: input.title,
      album: input.album,
      contentType: persisted.contentType,
      totalSize: persisted.totalSize,
    });
    void warmLiveHead(entry);
    return {
      id: `live:${entry.id}`,
      streamUrl: `/api/live/${entry.id}`,
    };
  }

  const pending = inFlight.get(qKey);
  if (pending) return pending;

  const work = (async () => {
    const remoteUrl = await resolveLiveRemoteUrl(query);
    if (!remoteUrl) return null;

    const entry = registerSession({
      queryKey: qKey,
      remoteUrl,
      artist: input.artist,
      title: input.title,
      album: input.album,
    });

    // Kick the warm now (browser's GET lands a few ms later) but don't block.
    void warmLiveHead(entry);
    writeRemoteUrl(entry);

    return {
      id: `live:${entry.id}`,
      streamUrl: `/api/live/${entry.id}`,
    };
  })().finally(() => {
    inFlight.delete(qKey);
  });

  inFlight.set(qKey, work);
  return work;
}
