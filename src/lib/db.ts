/**
 * Polarr persistence — SQLite (same model as Sonarr/Lidarr default).
 * Single file under POLARR_DATA_DIR (/data/polarr.db in Docker).
 *
 * Tracks: library audio on disk.
 * Requests: media acquisition lifecycle (Seerr-style).
 * Downloads: fallback yt-dlp jobs.
 */
import Database from "better-sqlite3";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { dbPath } from "./paths";

export type Settings = {
  setupComplete: boolean;
  lidarrUrl: string;
  lidarrApiKey: string;
  musicRoot: string;
  fallbackEnabled: boolean;
  serverName: string;
  publicUrl: string;
};

export type MediaType = "artist" | "album" | "track";

export type RequestStatus =
  | "pending"
  | "queued"
  | "downloading"
  | "available"
  | "failed"
  | "cancelled";

export type TrackRow = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  path: string;
  coverPath: string | null;
  source: "library" | "lidarr" | "fallback";
  externalId: string | null;
  fileSize: number;
  mtimeMs: number;
  addedAt: string;
  updatedAt: string;
};

export type RequestRow = {
  id: string;
  mediaType: MediaType;
  title: string;
  artist: string;
  album: string;
  status: RequestStatus;
  source: "lidarr" | "fallback";
  externalId: string | null;
  foreignArtistId: string | null;
  foreignAlbumId: string | null;
  lidarrArtistId: number | null;
  lidarrAlbumId: number | null;
  downloadJobId: string | null;
  requestedBy: string | null;
  error: string | null;
  availableAt: string | null;
  normalizedKey: string;
  createdAt: string;
  updatedAt: string;
};

export type DownloadJob = {
  id: string;
  requestId: string | null;
  query: string;
  title: string;
  artist: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  error: string | null;
  outputPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RequestEvent = {
  id: string;
  requestId: string;
  fromStatus: string | null;
  toStatus: string;
  message: string | null;
  createdAt: string;
};

let db: Database.Database | null = null;

const SCHEMA_VERSION = 2;

function hashPassword(password: string, salt?: string): string {
  const s = salt || randomBytes(16).toString("hex");
  const hash = scryptSync(password, s, 64).toString("hex");
  return `${s}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 64);
  const prev = Buffer.from(hash, "hex");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

function newId(bytes = 12): string {
  return randomBytes(bytes).toString("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Stable dedupe key for active requests. */
export function requestNormalizedKey(
  artist: string,
  title: string,
  mediaType: MediaType,
  album?: string,
): string {
  const a = artist.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  const al = (album || title).trim().toLowerCase();
  if (mediaType === "artist") return `artist:${a}`;
  if (mediaType === "album") return `album:${a}|${t}`;
  return `track:${a}|${al}|${t}`;
}

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

function tableColumns(database: Database.Database, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return new Set(rows.map((r) => r.name));
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  ddl: string,
) {
  if (!tableColumns(database, table).has(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      duration REAL NOT NULL DEFAULT 0,
      path TEXT NOT NULL UNIQUE,
      cover_path TEXT,
      source TEXT NOT NULL,
      external_id TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      mtime_ms REAL NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      media_type TEXT NOT NULL DEFAULT 'album',
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT,
      foreign_artist_id TEXT,
      foreign_album_id TEXT,
      lidarr_artist_id INTEGER,
      lidarr_album_id INTEGER,
      download_job_id TEXT,
      requested_by TEXT,
      error TEXT,
      available_at TEXT,
      normalized_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      query TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      error TEXT,
      output_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offline_marks (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL UNIQUE,
      device_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS request_events (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE
    );
  `);

  // Column upgrades for DBs created before v2
  ensureColumn(database, "users", "is_admin", "is_admin INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "tracks", "file_size", "file_size INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "tracks", "mtime_ms", "mtime_ms REAL NOT NULL DEFAULT 0");
  ensureColumn(database, "tracks", "updated_at", "updated_at TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "requests", "media_type", "media_type TEXT NOT NULL DEFAULT 'album'");
  ensureColumn(database, "requests", "foreign_artist_id", "foreign_artist_id TEXT");
  ensureColumn(database, "requests", "foreign_album_id", "foreign_album_id TEXT");
  ensureColumn(database, "requests", "lidarr_artist_id", "lidarr_artist_id INTEGER");
  ensureColumn(database, "requests", "lidarr_album_id", "lidarr_album_id INTEGER");
  ensureColumn(database, "requests", "download_job_id", "download_job_id TEXT");
  ensureColumn(database, "requests", "requested_by", "requested_by TEXT");
  ensureColumn(database, "requests", "available_at", "available_at TEXT");
  ensureColumn(database, "requests", "normalized_key", "normalized_key TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "downloads", "request_id", "request_id TEXT");

  // Backfill missing updated_at / normalized_key
  database.exec(`
    UPDATE tracks SET updated_at = added_at WHERE updated_at = '' OR updated_at IS NULL;
    UPDATE requests SET normalized_key =
      lower(media_type) || ':' || lower(artist) || '|' || lower(coalesce(nullif(album,''), title))
      WHERE normalized_key = '' OR normalized_key IS NULL;
  `);

  // Single-user installs are admin
  const userCount = database
    .prepare(`SELECT COUNT(*) as c FROM users`)
    .get() as { c: number };
  if (userCount.c === 1) {
    database.prepare(`UPDATE users SET is_admin = 1 WHERE is_admin = 0`).run();
  }

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
    CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
    CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source);
    CREATE INDEX IF NOT EXISTS idx_tracks_updated ON tracks(updated_at);

    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
    CREATE INDEX IF NOT EXISTS idx_requests_artist ON requests(artist);
    CREATE INDEX IF NOT EXISTS idx_requests_key ON requests(normalized_key);
    CREATE INDEX IF NOT EXISTS idx_requests_media ON requests(media_type);
    CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at);

    CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
    CREATE INDEX IF NOT EXISTS idx_downloads_request ON downloads(request_id);

    CREATE INDEX IF NOT EXISTS idx_request_events_request ON request_events(request_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  database
    .prepare(
      `INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)
       ON CONFLICT(version) DO NOTHING`,
    )
    .run(SCHEMA_VERSION, nowIso());
}

// ─── Settings ───────────────────────────────────────────────────────────────

function setSetting(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO settings(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

function getSetting(key: string, fallback = ""): string {
  const row = getDb()
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function getSettings(): Settings {
  return {
    setupComplete: getSetting("setupComplete", "false") === "true",
    lidarrUrl: getSetting("lidarrUrl", ""),
    lidarrApiKey: getSetting("lidarrApiKey", ""),
    musicRoot: getSetting("musicRoot", process.env.POLARR_MUSIC_DIR || ""),
    fallbackEnabled: getSetting("fallbackEnabled", "true") === "true",
    serverName: getSetting("serverName", "Polarr"),
    publicUrl: getSetting("publicUrl", ""),
  };
}

export function updateSettings(partial: Partial<Settings>): Settings {
  const current = getSettings();
  const next = { ...current, ...partial };
  setSetting("setupComplete", String(next.setupComplete));
  setSetting("lidarrUrl", next.lidarrUrl);
  setSetting("lidarrApiKey", next.lidarrApiKey);
  setSetting("musicRoot", next.musicRoot);
  setSetting("fallbackEnabled", String(next.fallbackEnabled));
  setSetting("serverName", next.serverName);
  setSetting("publicUrl", next.publicUrl);
  return next;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export function hasUsers(): boolean {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM users`)
    .get() as { c: number };
  return row.c > 0;
}

export function createUser(
  username: string,
  password: string,
  options?: { isAdmin?: boolean },
) {
  const id = newId();
  const isAdmin = options?.isAdmin ? 1 : 0;
  getDb()
    .prepare(
      `INSERT INTO users(id, username, password_hash, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, username, hashPassword(password), isAdmin, nowIso());
  return { id, username, isAdmin: Boolean(isAdmin) };
}

export function createAdminUser(username: string, password: string) {
  if (hasUsers()) throw new Error("Admin account already exists");
  const user = createUser(username, password, { isAdmin: true });
  updateSettings({ setupComplete: true });
  return user;
}

export function authenticate(username: string, password: string) {
  const row = getDb()
    .prepare(
      `SELECT id, username, password_hash, is_admin as isAdmin
       FROM users WHERE username = ?`,
    )
    .get(username) as
    | {
        id: string;
        username: string;
        password_hash: string;
        isAdmin: number;
      }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);
  getDb()
    .prepare(
      `INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    )
    .run(token, row.id, now.toISOString(), expires.toISOString());
  return {
    token,
    user: {
      id: row.id,
      username: row.username,
      isAdmin: Boolean(row.isAdmin),
    },
  };
}

export function getUserByToken(token: string | null | undefined) {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.id, u.username, u.is_admin as isAdmin, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as
    | {
        id: string;
        username: string;
        isAdmin: number;
        expires_at: string;
      }
    | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    id: row.id,
    username: row.username,
    isAdmin: Boolean(row.isAdmin),
  };
}

// ─── Tracks (library) ───────────────────────────────────────────────────────

function mapTrack(row: Record<string, unknown>): TrackRow {
  return {
    id: String(row.id),
    title: String(row.title),
    artist: String(row.artist),
    album: String(row.album),
    duration: Number(row.duration) || 0,
    path: String(row.path),
    coverPath: (row.coverPath as string | null) ?? null,
    source: row.source as TrackRow["source"],
    externalId: (row.externalId as string | null) ?? null,
    fileSize: Number(row.fileSize) || 0,
    mtimeMs: Number(row.mtimeMs) || 0,
    addedAt: String(row.addedAt),
    updatedAt: String(row.updatedAt || row.addedAt),
  };
}

const TRACK_SELECT = `
  SELECT id, title, artist, album, duration, path, cover_path as coverPath,
         source, external_id as externalId, file_size as fileSize,
         mtime_ms as mtimeMs, added_at as addedAt, updated_at as updatedAt
  FROM tracks`;

/** Resolve track by absolute path after insert/upsert. */
export function getTrackByPath(filePath: string): TrackRow | null {
  const row = getDb()
    .prepare(`${TRACK_SELECT} WHERE path = ? LIMIT 1`)
    .get(filePath) as Record<string, unknown> | undefined;
  return row ? mapTrack(row) : null;
}

export function findTrack(artist: string, title: string): TrackRow | null {
  const a = artist.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  const row = getDb()
    .prepare(
      `${TRACK_SELECT}
       WHERE lower(artist) = ? AND lower(title) = ?
       ORDER BY CASE source WHEN 'fallback' THEN 0 WHEN 'library' THEN 1 ELSE 2 END
       LIMIT 1`,
    )
    .get(a, t) as Record<string, unknown> | undefined;
  return row ? mapTrack(row) : null;
}

export function listTracks(limit = 200, offset = 0): TrackRow[] {
  return (
    getDb()
      .prepare(`${TRACK_SELECT} ORDER BY added_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as Record<string, unknown>[]
  ).map(mapTrack);
}

export function countTracks(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM tracks`)
    .get() as { c: number };
  return row.c;
}

export function searchTracksLocal(q: string, limit = 50): TrackRow[] {
  const like = `%${q}%`;
  return (
    getDb()
      .prepare(
        `${TRACK_SELECT}
         WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
         ORDER BY title ASC LIMIT ?`,
      )
      .all(like, like, like, limit) as Record<string, unknown>[]
  ).map(mapTrack);
}

export function getTrack(id: string): TrackRow | null {
  const row = getDb()
    .prepare(`${TRACK_SELECT} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapTrack(row) : null;
}

export function hasLibraryMatch(artist: string, albumOrTitle: string): boolean {
  const a = artist.trim().toLowerCase();
  const t = albumOrTitle.trim().toLowerCase();
  const row = getDb()
    .prepare(
      `SELECT 1 as ok FROM tracks
       WHERE lower(artist) = ? AND (lower(album) = ? OR lower(title) = ?)
       LIMIT 1`,
    )
    .get(a, t, t) as { ok: number } | undefined;
  return Boolean(row);
}

export function upsertTrack(
  track: Omit<TrackRow, "addedAt" | "updatedAt" | "fileSize" | "mtimeMs"> & {
    addedAt?: string;
    updatedAt?: string;
    fileSize?: number;
    mtimeMs?: number;
  },
) {
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO tracks(
         id, title, artist, album, duration, path, cover_path, source,
         external_id, file_size, mtime_ms, added_at, updated_at
       ) VALUES (
         @id, @title, @artist, @album, @duration, @path, @coverPath, @source,
         @externalId, @fileSize, @mtimeMs, @addedAt, @updatedAt
       )
       ON CONFLICT(path) DO UPDATE SET
         title=excluded.title,
         artist=excluded.artist,
         album=excluded.album,
         duration=excluded.duration,
         cover_path=excluded.cover_path,
         source=excluded.source,
         external_id=excluded.external_id,
         file_size=excluded.file_size,
         mtime_ms=excluded.mtime_ms,
         updated_at=excluded.updated_at`,
    )
    .run({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      path: track.path,
      coverPath: track.coverPath,
      source: track.source,
      externalId: track.externalId,
      fileSize: track.fileSize ?? 0,
      mtimeMs: track.mtimeMs ?? 0,
      addedAt: track.addedAt || ts,
      updatedAt: track.updatedAt || ts,
    });

  // Library import may satisfy open requests
  markMatchingRequestsAvailable(track.artist, track.album, track.title);
}

// ─── Requests ───────────────────────────────────────────────────────────────

function mapRequest(row: Record<string, unknown>): RequestRow {
  return {
    id: String(row.id),
    mediaType: (row.mediaType as MediaType) || "album",
    title: String(row.title),
    artist: String(row.artist),
    album: String(row.album),
    status: row.status as RequestStatus,
    source: row.source as RequestRow["source"],
    externalId: (row.externalId as string | null) ?? null,
    foreignArtistId: (row.foreignArtistId as string | null) ?? null,
    foreignAlbumId: (row.foreignAlbumId as string | null) ?? null,
    lidarrArtistId:
      row.lidarrArtistId != null ? Number(row.lidarrArtistId) : null,
    lidarrAlbumId: row.lidarrAlbumId != null ? Number(row.lidarrAlbumId) : null,
    downloadJobId: (row.downloadJobId as string | null) ?? null,
    requestedBy: (row.requestedBy as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    availableAt: (row.availableAt as string | null) ?? null,
    normalizedKey: String(row.normalizedKey || ""),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

const REQUEST_SELECT = `
  SELECT id, media_type as mediaType, title, artist, album, status, source,
         external_id as externalId, foreign_artist_id as foreignArtistId,
         foreign_album_id as foreignAlbumId, lidarr_artist_id as lidarrArtistId,
         lidarr_album_id as lidarrAlbumId, download_job_id as downloadJobId,
         requested_by as requestedBy, error, available_at as availableAt,
         normalized_key as normalizedKey, created_at as createdAt,
         updated_at as updatedAt
  FROM requests`;

export function appendRequestEvent(
  requestId: string,
  toStatus: string,
  message?: string | null,
  fromStatus?: string | null,
) {
  getDb()
    .prepare(
      `INSERT INTO request_events(id, request_id, from_status, to_status, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(newId(8), requestId, fromStatus ?? null, toStatus, message ?? null, nowIso());
}

export function findActiveRequest(normalizedKey: string): RequestRow | null {
  const row = getDb()
    .prepare(
      `${REQUEST_SELECT}
       WHERE normalized_key = ?
         AND status NOT IN ('available', 'failed', 'cancelled')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(normalizedKey) as Record<string, unknown> | undefined;
  return row ? mapRequest(row) : null;
}

export function createRequest(input: {
  title: string;
  artist: string;
  album?: string;
  mediaType?: MediaType;
  status: RequestStatus;
  source: "lidarr" | "fallback";
  externalId?: string | null;
  foreignArtistId?: string | null;
  foreignAlbumId?: string | null;
  lidarrArtistId?: number | null;
  lidarrAlbumId?: number | null;
  downloadJobId?: string | null;
  requestedBy?: string | null;
  error?: string | null;
}): RequestRow {
  const mediaType = input.mediaType ?? "album";
  const album = input.album || input.title;
  const key = requestNormalizedKey(
    input.artist,
    input.title,
    mediaType,
    album,
  );

  const existing = findActiveRequest(key);
  if (existing) {
    return existing;
  }

  // Already in local library?
  if (
    mediaType !== "artist" &&
    hasLibraryMatch(input.artist, mediaType === "track" ? input.title : album)
  ) {
    const now = nowIso();
    const row: RequestRow = {
      id: newId(),
      mediaType,
      title: input.title,
      artist: input.artist,
      album,
      status: "available",
      source: input.source,
      externalId: input.externalId ?? null,
      foreignArtistId: input.foreignArtistId ?? null,
      foreignAlbumId: input.foreignAlbumId ?? null,
      lidarrArtistId: input.lidarrArtistId ?? null,
      lidarrAlbumId: input.lidarrAlbumId ?? null,
      downloadJobId: input.downloadJobId ?? null,
      requestedBy: input.requestedBy ?? null,
      error: null,
      availableAt: now,
      normalizedKey: key,
      createdAt: now,
      updatedAt: now,
    };
    insertRequestRow(row);
    appendRequestEvent(row.id, "available", "Already present in library");
    return row;
  }

  const now = nowIso();
  const row: RequestRow = {
    id: newId(),
    mediaType,
    title: input.title,
    artist: input.artist,
    album,
    status: input.status,
    source: input.source,
    externalId: input.externalId ?? null,
    foreignArtistId: input.foreignArtistId ?? null,
    foreignAlbumId: input.foreignAlbumId ?? null,
    lidarrArtistId: input.lidarrArtistId ?? null,
    lidarrAlbumId: input.lidarrAlbumId ?? null,
    downloadJobId: input.downloadJobId ?? null,
    requestedBy: input.requestedBy ?? null,
    error: input.error ?? null,
    availableAt: null,
    normalizedKey: key,
    createdAt: now,
    updatedAt: now,
  };
  insertRequestRow(row);
  appendRequestEvent(row.id, row.status, "Request created");
  return row;
}

function insertRequestRow(row: RequestRow) {
  getDb()
    .prepare(
      `INSERT INTO requests(
         id, media_type, title, artist, album, status, source, external_id,
         foreign_artist_id, foreign_album_id, lidarr_artist_id, lidarr_album_id,
         download_job_id, requested_by, error, available_at, normalized_key,
         created_at, updated_at
       ) VALUES (
         @id, @mediaType, @title, @artist, @album, @status, @source, @externalId,
         @foreignArtistId, @foreignAlbumId, @lidarrArtistId, @lidarrAlbumId,
         @downloadJobId, @requestedBy, @error, @availableAt, @normalizedKey,
         @createdAt, @updatedAt
       )`,
    )
    .run(row);
}

export function updateRequestStatus(
  id: string,
  status: RequestStatus,
  patch?: {
    error?: string | null;
    downloadJobId?: string | null;
    externalId?: string | null;
    message?: string;
  },
): RequestRow | null {
  const current = getRequest(id);
  if (!current) return null;
  const now = nowIso();
  const availableAt =
    status === "available" ? now : current.availableAt;
  getDb()
    .prepare(
      `UPDATE requests SET
         status = @status,
         error = @error,
         download_job_id = COALESCE(@downloadJobId, download_job_id),
         external_id = COALESCE(@externalId, external_id),
         available_at = @availableAt,
         updated_at = @updatedAt
       WHERE id = @id`,
    )
    .run({
      id,
      status,
      error: patch?.error !== undefined ? patch.error : current.error,
      downloadJobId: patch?.downloadJobId ?? null,
      externalId: patch?.externalId ?? null,
      availableAt,
      updatedAt: now,
    });
  appendRequestEvent(
    id,
    status,
    patch?.message ?? null,
    current.status,
  );
  return getRequest(id);
}

export function getRequest(id: string): RequestRow | null {
  const row = getDb()
    .prepare(`${REQUEST_SELECT} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapRequest(row) : null;
}

export function listRequests(limit = 100): RequestRow[] {
  return (
    getDb()
      .prepare(`${REQUEST_SELECT} ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[]
  ).map(mapRequest);
}

export function listRequestEvents(
  requestId: string,
  limit = 50,
): RequestEvent[] {
  return getDb()
    .prepare(
      `SELECT id, request_id as requestId, from_status as fromStatus,
              to_status as toStatus, message, created_at as createdAt
       FROM request_events WHERE request_id = ?
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(requestId, limit) as RequestEvent[];
}

/** When files land in the library, close matching open requests. */
export function markMatchingRequestsAvailable(
  artist: string,
  album: string,
  title: string,
): number {
  const a = artist.trim().toLowerCase();
  const al = album.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  const open = getDb()
    .prepare(
      `${REQUEST_SELECT}
       WHERE status NOT IN ('available', 'cancelled')
         AND lower(artist) = ?
         AND (
           lower(album) = ? OR lower(title) = ? OR lower(title) = ?
           OR (media_type = 'track' AND lower(title) = ?)
         )`,
    )
    .all(a, al, al, t, t) as Record<string, unknown>[];

  let n = 0;
  for (const raw of open) {
    const req = mapRequest(raw);
    updateRequestStatus(req.id, "available", {
      error: null,
      message: "Matched local library file",
    });
    n += 1;
  }
  return n;
}

export function requestStats() {
  const rows = getDb()
    .prepare(
      `SELECT status, COUNT(*) as c FROM requests GROUP BY status`,
    )
    .all() as { status: string; c: number }[];
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = r.c;
    total += r.c;
  }
  return { total, byStatus, tracks: countTracks() };
}

// ─── Downloads ──────────────────────────────────────────────────────────────

export function createDownloadJob(input: {
  query: string;
  title: string;
  artist: string;
  requestId?: string | null;
}): DownloadJob {
  const now = nowIso();
  const job: DownloadJob = {
    id: newId(),
    requestId: input.requestId ?? null,
    query: input.query,
    title: input.title,
    artist: input.artist,
    status: "queued",
    progress: 0,
    error: null,
    outputPath: null,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO downloads(
         id, request_id, query, title, artist, status, progress, error,
         output_path, created_at, updated_at
       ) VALUES (
         @id, @requestId, @query, @title, @artist, @status, @progress, @error,
         @outputPath, @createdAt, @updatedAt
       )`,
    )
    .run(job);
  if (job.requestId) {
    updateRequestStatus(job.requestId, "downloading", {
      downloadJobId: job.id,
      message: "Fallback download queued",
    });
  }
  return job;
}

export function updateDownloadJob(
  id: string,
  patch: Partial<
    Pick<DownloadJob, "status" | "progress" | "error" | "outputPath">
  >,
) {
  const current = getDb()
    .prepare(
      `SELECT id, request_id as requestId, query, title, artist, status, progress,
              error, output_path as outputPath, created_at as createdAt,
              updated_at as updatedAt FROM downloads WHERE id = ?`,
    )
    .get(id) as DownloadJob | undefined;
  if (!current) return null;
  const next: DownloadJob = {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  };
  getDb()
    .prepare(
      `UPDATE downloads SET status=@status, progress=@progress, error=@error,
       output_path=@outputPath, updated_at=@updatedAt WHERE id=@id`,
    )
    .run(next);

  if (current.requestId) {
    if (patch.status === "completed") {
      updateRequestStatus(current.requestId, "available", {
        message: "Fallback download completed",
        error: null,
      });
    } else if (patch.status === "failed") {
      updateRequestStatus(current.requestId, "failed", {
        error: patch.error ?? "Download failed",
        message: patch.error ?? "Fallback download failed",
      });
    } else if (patch.status === "running") {
      updateRequestStatus(current.requestId, "downloading", {
        message: "Fallback download running",
      });
    }
  }
  return next;
}

export function listDownloads(limit = 50): DownloadJob[] {
  return getDb()
    .prepare(
      `SELECT id, request_id as requestId, query, title, artist, status, progress,
              error, output_path as outputPath, created_at as createdAt,
              updated_at as updatedAt
       FROM downloads ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as DownloadJob[];
}

// ─── Offline marks ──────────────────────────────────────────────────────────

export function markOffline(trackId: string, deviceId?: string) {
  getDb()
    .prepare(
      `INSERT INTO offline_marks(id, track_id, device_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(track_id) DO UPDATE SET device_id=excluded.device_id`,
    )
    .run(newId(8), trackId, deviceId ?? null, nowIso());
}
