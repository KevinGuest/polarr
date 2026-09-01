/**
 * Polarr persistence — SQLite (same model as Sonarr/Lidarr default).
 * Single file under POLARR_DATA_DIR (/data/polarr.db in Docker).
 *
 * Tracks: library audio on disk.
 * Requests: media acquisition lifecycle (Seerr-style).
 * Downloads: fallback yt-dlp jobs.
 */
import Database from "better-sqlite3";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { avatarsDir, dbPath, playlistCoversDir, unlinkManagedAudioFile } from "./paths";
import {
  parseNotifyEvents,
  serializeNotifyEvents,
  type NotifyEventFlags,
} from "./notify-events";
import {
  LISTEN_HEARTBEAT_SECONDS,
  LISTEN_QUALIFY_SECONDS,
} from "./listen";
import {
  isUserRole,
  type UserRole,
} from "./roles";
import {
  DEFAULT_DOWNLOAD_QUALITY,
  isDownloadQuality,
  type DownloadQuality,
} from "./download-quality";
import {
  cleanAudioTag,
  isArtworkAudioPath,
  isArtworkFilename,
} from "./audio-tags";
import {
  parseEmailTemplatesJson,
  serializeEmailTemplateOverrides,
  type EmailTemplatesMap,
} from "./email-templates";
import {
  matchSearchQueries,
  namesMatch,
  primaryArtistName,
  scoreSearchHit,
  scoreTrackMatch,
  titlesMatch,
  tokenizeSearchQuery,
  TRACK_MATCH_MIN_SCORE,
  trackMatchKey,
} from "./track-match";

export type { UserRole } from "./roles";
export type { NotifyEventFlags, NotifyEventId } from "./notify-events";
export {
  DEFAULT_NOTIFY_EVENTS,
  NOTIFY_EVENTS,
  NOTIFY_EVENT_IDS,
} from "./notify-events";

export type Settings = {
  setupComplete: boolean;
  lidarrUrl: string;
  lidarrApiKey: string;
  musicRoot: string;
  fallbackEnabled: boolean;
  /** Fallback download quality preset (see lib/download-quality). */
  downloadQuality: DownloadQuality;
  serverName: string;
  publicUrl: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  smtpSecure: boolean;
  notifyEmailEnabled: boolean;
  notifyDiscordEnabled: boolean;
  discordWebhookUrl: string;
  notifyEmailEvents: NotifyEventFlags;
  notifyDiscordEvents: NotifyEventFlags;
  /** Spotify app credentials for public playlist import (Client Credentials). */
  spotifyClientId: string;
  spotifyClientSecret: string;
  /** Genius API client (search) + access token for duet lyric structure. */
  geniusClientId: string;
  geniusClientSecret: string;
  geniusAccessToken: string;
  /** Discord OAuth app (user linking + Rich Presence client id). */
  discordClientId: string;
  discordClientSecret: string;
  /** When a catalog track is played live, also acquire it into the library. */
  saveOnPlay: boolean;
  /**
   * Auto library scan interval in minutes.
   * 0 = off; otherwise 15 / 30 / 60. Env POLARR_LIBRARY_SCAN_MINUTES overrides.
   */
  libraryScanMinutes: number;
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
  source: "library" | "lidarr" | "fallback" | "stream";
  externalId: string | null;
  fileSize: number;
  mtimeMs: number;
  addedAt: string;
  updatedAt: string;
};

export type LikeMeta = {
  title?: string;
  artist?: string;
  album?: string;
  coverPath?: string | null;
  duration?: number;
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
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
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

const SCHEMA_VERSION = 3;

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
  const file = dbPath();
  try {
    db = new Database(file);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code === "SQLITE_CANTOPEN") {
      throw new Error(
        `Unable to open database at ${file}. ` +
          `Data directory must be writable by the container user (uid 1000). ` +
          `Fix: sudo chown -R 1000:1000 ./data ./music`,
        { cause: err },
      );
    }
    throw err;
  }
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

/**
 * Exactly one Server Owner. Promote the earliest admin if missing; demote extras.
 */
function ensureSingleServerOwner(database: Database.Database) {
  const owners = database
    .prepare(
      `SELECT id FROM users WHERE role = 'owner' ORDER BY created_at ASC, id ASC`,
    )
    .all() as { id: string }[];

  if (owners.length === 0) {
    const candidate = database
      .prepare(
        `SELECT id FROM users
         WHERE is_admin = 1 OR role IN ('admin', 'owner')
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;
    if (candidate) {
      database
        .prepare(
          `UPDATE users SET role = 'owner', is_admin = 1 WHERE id = ?`,
        )
        .run(candidate.id);
    }
    return;
  }

  if (owners.length > 1) {
    const keep = owners[0]!.id;
    for (const row of owners.slice(1)) {
      database
        .prepare(
          `UPDATE users SET role = 'admin', is_admin = 1 WHERE id = ?`,
        )
        .run(row.id);
    }
    database
      .prepare(`UPDATE users SET role = 'owner', is_admin = 1 WHERE id = ?`)
      .run(keep);
  }
}

/** Stable id for likes that aren't (yet) in the local library. */
export function streamLikeId(artist: string, title: string): string {
  return `stream:${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
}

/**
 * Ensure a tracks row exists for play history / recently played when the
 * listen was live/stream-only (no library file yet). Prefers a real library
 * match when one exists.
 */
export function ensureHistoryTrack(input: {
  title: string;
  artist: string;
  album?: string;
  coverPath?: string | null;
}): TrackRow | null {
  const title = cleanAudioTag(input.title);
  const artist = cleanAudioTag(input.artist) || input.artist.trim();
  if (!title || !artist || isArtworkFilename(title)) return null;

  const local = findTrack(artist, title);
  if (local) return local;

  const id = streamLikeId(artist, title);
  const existing = getTrack(id);
  if (existing) {
    if (isArtworkFilename(existing.title)) {
      deleteTrack(id);
    } else if (input.coverPath && !existing.coverPath) {
      upsertTrack({
        ...existing,
        coverPath: input.coverPath,
        album: input.album?.trim() || existing.album,
      });
      return getTrack(id);
    } else {
      return existing;
    }
  }

  upsertTrack({
    id,
    title,
    artist,
    album: cleanAudioTag(input.album) || input.album?.trim() || title,
    duration: 0,
    path: `stream://${id}`,
    coverPath: input.coverPath || null,
    source: "stream",
    externalId: null,
  });
  return getTrack(id);
}

/** Fill match_key from artist/title for rows indexed before the column existed. */
function backfillTrackMatchKeys(database: Database.Database) {
  const rows = database
    .prepare(
      `SELECT id, artist, title FROM tracks
       WHERE match_key = '' OR match_key IS NULL`,
    )
    .all() as { id: string; artist: string; title: string }[];
  if (!rows.length) return;
  const upd = database.prepare(`UPDATE tracks SET match_key = ? WHERE id = ?`);
  const tx = database.transaction(() => {
    for (const row of rows) {
      const key = trackMatchKey(row.artist, row.title);
      if (key) upd.run(key, row.id);
    }
  });
  tx();
}

function titleFromAudioPath(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath)).trim();
  if (!base || isArtworkFilename(base)) return "";
  const cleaned = base.replace(/^\d{1,3}(\s*[-.]\s*|\s+)/, "").trim();
  if (cleaned.includes(" - ")) {
    const [, ...rest] = cleaned.split(" - ");
    const title = rest.join(" - ").trim();
    if (title && !isArtworkFilename(title)) return title;
  }
  return cleaned;
}

/**
 * Remove or repair tracks whose title/path is album artwork (cover.jpg, …).
 * Safe to re-run. Uses the open Database handle (startup migrate).
 */
function purgeArtworkNamedTracks(database: Database.Database) {
  const rows = database
    .prepare(`SELECT id, title, artist, album, path FROM tracks`)
    .all() as {
    id: string;
    title: string;
    artist: string;
    album: string;
    path: string;
  }[];
  if (!rows.length) return;

  const delRelated = database.transaction((id: string) => {
    database.prepare(`DELETE FROM play_history WHERE track_id = ?`).run(id);
    database.prepare(`DELETE FROM offline_marks WHERE track_id = ?`).run(id);
    database.prepare(`DELETE FROM playlist_tracks WHERE track_id = ?`).run(id);
    try {
      database.prepare(`DELETE FROM listening_feed WHERE track_id = ?`).run(id);
    } catch {
      /* table may not exist yet on older paths */
    }
    database.prepare(`DELETE FROM tracks WHERE id = ?`).run(id);
  });

  const repair = database.prepare(
    `UPDATE tracks SET title = ?, match_key = ?, updated_at = ? WHERE id = ?`,
  );

  for (const row of rows) {
    const titleJunk = isArtworkFilename(row.title);
    const pathJunk = isArtworkAudioPath(row.path);
    if (!titleJunk && !pathJunk) continue;

    if (pathJunk || row.path.startsWith("stream:") || row.path.startsWith("stream://")) {
      delRelated(row.id);
      continue;
    }

    const fixed = titleFromAudioPath(row.path);
    if (!fixed) {
      delRelated(row.id);
      continue;
    }
    repair.run(
      fixed,
      trackMatchKey(row.artist, fixed),
      new Date().toISOString(),
      row.id,
    );
  }
}

/**
 * Drop track FK and keep title/artist metadata so streamed tracks can be liked
 * without downloading. Safe to re-run (no-op when already migrated).
 */
function migrateTrackLikesV3(database: Database.Database) {
  const cols = tableColumns(database, "track_likes");
  const ddl = (
    database
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'track_likes'`,
      )
      .get() as { sql: string } | undefined
  )?.sql;
  const hasTrackFk = Boolean(ddl?.includes("REFERENCES tracks"));
  if (cols.has("title") && cols.has("artist") && !hasTrackFk) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS track_likes_v3 (
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      liked_at TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      cover_path TEXT,
      duration REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, track_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  if (cols.size > 0) {
    database.exec(`
      INSERT OR IGNORE INTO track_likes_v3(
        user_id, track_id, liked_at, title, artist, album, cover_path, duration
      )
      SELECT
        l.user_id,
        l.track_id,
        l.liked_at,
        coalesce(t.title, ${cols.has("title") ? "l.title" : "''"}),
        coalesce(t.artist, ${cols.has("artist") ? "l.artist" : "''"}),
        coalesce(t.album, ${cols.has("album") ? "l.album" : "''"}),
        coalesce(t.cover_path, ${cols.has("cover_path") ? "l.cover_path" : "NULL"}),
        coalesce(t.duration, ${cols.has("duration") ? "l.duration" : "0"})
      FROM track_likes l
      LEFT JOIN tracks t ON t.id = l.track_id;
      DROP TABLE track_likes;
    `);
  } else {
    database.exec(`DROP TABLE IF EXISTS track_likes;`);
  }

  database.exec(`ALTER TABLE track_likes_v3 RENAME TO track_likes;`);
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_track_likes_user ON track_likes(user_id, liked_at DESC);`,
  );
}

/**
 * Offline "Downloaded" marks used to be global (UNIQUE track_id, no user) so
 * one user's download badged every library. Rebuild per-user. Legacy rows
 * can't be attributed to anyone, so they are dropped — badge only, files stay.
 */
function migrateOfflineMarksV2(database: Database.Database) {
  const cols = tableColumns(database, "offline_marks");
  if (cols.size === 0 || cols.has("user_id")) return;
  database.exec(`
    DROP TABLE offline_marks;
    CREATE TABLE offline_marks (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      device_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(track_id, user_id),
      FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

/**
 * Seed durable household listening shelf from existing ≥15s plays (once).
 * Survives later play_history pruning so “others listening” doesn’t vanish.
 */
function backfillListeningFeed(database: Database.Database) {
  try {
    const row = database
      .prepare(`SELECT COUNT(*) as c FROM listening_feed`)
      .get() as { c: number };
    if (Number(row?.c) > 0) return;
  } catch {
    return;
  }
  database.exec(`
    INSERT OR IGNORE INTO listening_feed(user_id, track_id, played_at)
    SELECT p.user_id, p.track_id, MAX(p.played_at)
    FROM play_history p
    WHERE p.listened_seconds IS NULL OR p.listened_seconds >= 15
    GROUP BY p.user_id, p.track_id
  `);
}

/** Cap for the durable household listening shelf (not per-user history). */
const LISTENING_FEED_CAP = 500;

function upsertListeningFeed(
  userId: string,
  trackId: string,
  playedAt: string,
) {
  if (!userId || !trackId) return;
  getDb()
    .prepare(
      `INSERT INTO listening_feed(user_id, track_id, played_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, track_id) DO UPDATE SET
         played_at = excluded.played_at`,
    )
    .run(userId, trackId, playedAt);

  getDb()
    .prepare(
      `DELETE FROM listening_feed
       WHERE rowid IN (
         SELECT rowid FROM listening_feed
         ORDER BY played_at DESC
         LIMIT -1 OFFSET ?
       )`,
    )
    .run(LISTENING_FEED_CAP);
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
      match_key TEXT NOT NULL DEFAULT '',
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
      track_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      device_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(track_id, user_id),
      FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
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

    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      used_by TEXT,
      used_at TEXT,
      emailed_to TEXT,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_changes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS listen_daily (
      user_id TEXT NOT NULL,
      day TEXT NOT NULL,
      seconds REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS listen_bucket (
      user_id TEXT NOT NULL,
      bucket TEXT NOT NULL,
      seconds REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, bucket),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS play_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      played_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS track_likes (
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      liked_at TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      cover_path TEXT,
      duration REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, track_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cover_path TEXT,
      folder_id TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS playlist_folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL,
      PRIMARY KEY (playlist_id, track_id),
      FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS taste_excludes (
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, track_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      actor_label TEXT NOT NULL,
      message TEXT NOT NULL,
      href TEXT,
      image_seed TEXT,
      request_id TEXT,
      dedupe_key TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Column upgrades for DBs created before v2
  ensureColumn(database, "users", "is_admin", "is_admin INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "users", "avatar_path", "avatar_path TEXT");
  ensureColumn(database, "users", "banner_colors", "banner_colors TEXT");
  ensureColumn(database, "users", "email", "email TEXT");
  ensureColumn(database, "users", "discord_id", "discord_id TEXT");
  ensureColumn(database, "users", "discord_username", "discord_username TEXT");
  ensureColumn(
    database,
    "users",
    "discord_access_token",
    "discord_access_token TEXT",
  );
  ensureColumn(
    database,
    "users",
    "discord_refresh_token",
    "discord_refresh_token TEXT",
  );
  ensureColumn(
    database,
    "users",
    "discord_token_expires_at",
    "discord_token_expires_at TEXT",
  );
  ensureColumn(
    database,
    "users",
    "discord_presence_enabled",
    "discord_presence_enabled INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(database, "users", "discord_avatar", "discord_avatar TEXT");
  ensureColumn(
    database,
    "users",
    "discord_display_name",
    "discord_display_name TEXT",
  );
  ensureColumn(
    database,
    "users",
    "discord_login_enabled",
    "discord_login_enabled INTEGER NOT NULL DEFAULT 1",
  );
  ensureColumn(database, "invites", "emailed_to", "emailed_to TEXT");
  ensureColumn(
    database,
    "users",
    "role",
    "role TEXT NOT NULL DEFAULT 'member'",
  );
  ensureColumn(database, "users", "last_ip", "last_ip TEXT");
  ensureColumn(database, "users", "last_hwid", "last_hwid TEXT");
  ensureColumn(
    database,
    "users",
    "access_revoked_at",
    "access_revoked_at TEXT",
  );
  ensureColumn(database, "sessions", "ip", "ip TEXT");
  ensureColumn(database, "sessions", "hwid", "hwid TEXT");
  ensureColumn(database, "sessions", "user_agent", "user_agent TEXT");
  ensureColumn(database, "sessions", "last_seen_at", "last_seen_at TEXT");
  ensureColumn(database, "tracks", "file_size", "file_size INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "tracks", "mtime_ms", "mtime_ms REAL NOT NULL DEFAULT 0");
  ensureColumn(database, "tracks", "updated_at", "updated_at TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "tracks", "match_key", "match_key TEXT NOT NULL DEFAULT ''");
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
  ensureColumn(
    database,
    "play_history",
    "listened_seconds",
    "listened_seconds REAL",
  );
  ensureColumn(database, "notifications", "image_url", "image_url TEXT");
  ensureColumn(database, "notifications", "media_type", "media_type TEXT");
  ensureColumn(database, "playlists", "cover_path", "cover_path TEXT");
  ensureColumn(database, "playlists", "folder_id", "folder_id TEXT");
  ensureColumn(
    database,
    "playlists",
    "description",
    "description TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    database,
    "playlists",
    "is_private",
    "is_private INTEGER NOT NULL DEFAULT 0",
  );

  // Bans table for existing installs (also in main CREATE for new DBs)
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_bans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ban_stream INTEGER NOT NULL DEFAULT 0,
      ban_download INTEGER NOT NULL DEFAULT 0,
      ban_user INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      reason TEXT,
      created_by TEXT,
      created_by_username TEXT,
      created_at TEXT NOT NULL,
      lifted_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lyrics_cache (
      cache_key TEXT PRIMARY KEY,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      quality TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'lrclib',
      external_id TEXT,
      source_duration_sec REAL,
      lines_json TEXT NOT NULL DEFAULT '[]',
      offset_sec REAL NOT NULL DEFAULT 0,
      offset_user_set INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL,
      aligned_json TEXT,
      aligned_fingerprint TEXT
    );

    CREATE TABLE IF NOT EXISTS library_pins (
      user_id TEXT NOT NULL,
      item_key TEXT NOT NULL,
      pinned_at TEXT NOT NULL,
      PRIMARY KEY (user_id, item_key),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Durable household “what others are listening to” feed (survives play_history prune).
    CREATE TABLE IF NOT EXISTS listening_feed (
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      played_at TEXT NOT NULL,
      PRIMARY KEY (user_id, track_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_listening_feed_played
      ON listening_feed(played_at DESC);
  `);
  ensureColumn(
    database,
    "lyrics_cache",
    "offset_user_set",
    "offset_user_set INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(database, "lyrics_cache", "aligned_json", "aligned_json TEXT");
  ensureColumn(
    database,
    "lyrics_cache",
    "aligned_fingerprint",
    "aligned_fingerprint TEXT",
  );
  ensureColumn(
    database,
    "lyrics_cache",
    "genius_json",
    "genius_json TEXT",
  );

  // v3: likes may reference streamed tracks (no library file / no track FK)
  migrateTrackLikesV3(database);

  // v2: offline marks are per-user, not global
  migrateOfflineMarksV2(database);

  backfillListeningFeed(database);

  // Backfill missing updated_at / normalized_key
  database.exec(`
    UPDATE tracks SET updated_at = added_at WHERE updated_at = '' OR updated_at IS NULL;
    UPDATE requests SET normalized_key =
      lower(media_type) || ':' || lower(artist) || '|' || lower(coalesce(nullif(album,''), title))
      WHERE normalized_key = '' OR normalized_key IS NULL;
  `);

  backfillTrackMatchKeys(database);

  // Drop / repair cover.jpg etc. wrongly stored as tracks (one-shot + idempotent).
  purgeArtworkNamedTracks(database);

  // Single-user installs are the server owner
  const userCount = database
    .prepare(`SELECT COUNT(*) as c FROM users`)
    .get() as { c: number };
  if (userCount.c === 1) {
    database
      .prepare(
        `UPDATE users SET is_admin = 1, role = 'owner'
         WHERE is_admin = 0 OR role IS NULL OR role = '' OR role = 'member' OR role = 'admin'`,
      )
      .run();
  }

  // Legacy is_admin / role sync, then ensure exactly one server owner
  database.exec(`
    UPDATE users SET role = 'admin' WHERE is_admin = 1 AND (role IS NULL OR role = '' OR role = 'member');
    UPDATE users SET is_admin = 1 WHERE role IN ('admin', 'owner') AND is_admin = 0;
    UPDATE users SET is_admin = 0 WHERE role NOT IN ('admin', 'owner') AND is_admin = 1;
  `);
  ensureSingleServerOwner(database);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
    CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
    CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source);
    CREATE INDEX IF NOT EXISTS idx_tracks_updated ON tracks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tracks_match_key ON tracks(match_key);

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
    CREATE INDEX IF NOT EXISTS idx_listen_daily_day ON listen_daily(day);
    CREATE INDEX IF NOT EXISTS idx_listen_bucket ON listen_bucket(bucket);
    CREATE INDEX IF NOT EXISTS idx_play_history_user ON play_history(user_id, played_at DESC);
    CREATE INDEX IF NOT EXISTS idx_play_history_track ON play_history(track_id);
    CREATE INDEX IF NOT EXISTS idx_track_likes_user ON track_likes(user_id, liked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_playlists_folder ON playlists(folder_id);
    CREATE INDEX IF NOT EXISTS idx_playlist_folders_user ON playlist_folders(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks ON playlist_tracks(playlist_id, position);
    CREATE INDEX IF NOT EXISTS idx_taste_excludes_user ON taste_excludes(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at);
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
  const portRaw = getSetting("smtpPort", "587");
  const port = Number.parseInt(portRaw, 10);
  const qualityRaw = getSetting("downloadQuality", DEFAULT_DOWNLOAD_QUALITY);
  return {
    setupComplete: getSetting("setupComplete", "false") === "true",
    lidarrUrl: getSetting("lidarrUrl", ""),
    lidarrApiKey: getSetting("lidarrApiKey", ""),
    musicRoot: getSetting("musicRoot", process.env.POLARR_MUSIC_DIR || ""),
    fallbackEnabled: true, // always-on acquire path (Lidarr + yt-dlp)
    downloadQuality: isDownloadQuality(qualityRaw)
      ? qualityRaw
      : DEFAULT_DOWNLOAD_QUALITY,
    serverName: getSetting("serverName", "Polarr"),
    publicUrl: getSetting("publicUrl", ""),
    smtpHost: getSetting("smtpHost", ""),
    smtpPort: Number.isFinite(port) && port > 0 ? port : 587,
    smtpUser: getSetting("smtpUser", ""),
    smtpPassword: getSetting("smtpPassword", ""),
    smtpFrom: getSetting("smtpFrom", ""),
    smtpSecure: getSetting("smtpSecure", "false") === "true",
    notifyEmailEnabled: getSetting("notifyEmailEnabled", "false") === "true",
    notifyDiscordEnabled:
      getSetting("notifyDiscordEnabled", "false") === "true",
    discordWebhookUrl: getSetting("discordWebhookUrl", ""),
    notifyEmailEvents: parseNotifyEvents(getSetting("notifyEmailEvents", "")),
    notifyDiscordEvents: parseNotifyEvents(
      getSetting("notifyDiscordEvents", ""),
    ),
    spotifyClientId:
      getSetting("spotifyClientId", "") ||
      process.env.POLARR_SPOTIFY_CLIENT_ID ||
      "",
    spotifyClientSecret:
      getSetting("spotifyClientSecret", "") ||
      process.env.POLARR_SPOTIFY_CLIENT_SECRET ||
      "",
    geniusClientId:
      getSetting("geniusClientId", "") ||
      process.env.POLARR_GENIUS_CLIENT_ID ||
      "",
    geniusClientSecret:
      getSetting("geniusClientSecret", "") ||
      process.env.POLARR_GENIUS_CLIENT_SECRET ||
      "",
    geniusAccessToken:
      getSetting("geniusAccessToken", "") ||
      process.env.POLARR_GENIUS_ACCESS_TOKEN ||
      "",
    discordClientId:
      getSetting("discordClientId", "") ||
      process.env.POLARR_DISCORD_CLIENT_ID ||
      "",
    discordClientSecret:
      getSetting("discordClientSecret", "") ||
      process.env.POLARR_DISCORD_CLIENT_SECRET ||
      "",
    saveOnPlay: getSetting("saveOnPlay", "true") !== "false",
    libraryScanMinutes: (() => {
      const raw = getSetting("libraryScanMinutes", "30");
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) return 0;
      if (n <= 15) return 15;
      if (n <= 30) return 30;
      return 60;
    })(),
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
  setSetting("downloadQuality", next.downloadQuality);
  setSetting("serverName", next.serverName);
  setSetting("publicUrl", next.publicUrl);
  setSetting("smtpHost", next.smtpHost);
  setSetting("smtpPort", String(next.smtpPort));
  setSetting("smtpUser", next.smtpUser);
  setSetting("smtpPassword", next.smtpPassword);
  setSetting("smtpFrom", next.smtpFrom);
  setSetting("smtpSecure", String(next.smtpSecure));
  setSetting("notifyEmailEnabled", String(next.notifyEmailEnabled));
  setSetting("notifyDiscordEnabled", String(next.notifyDiscordEnabled));
  setSetting("discordWebhookUrl", next.discordWebhookUrl);
  setSetting("notifyEmailEvents", serializeNotifyEvents(next.notifyEmailEvents));
  setSetting(
    "notifyDiscordEvents",
    serializeNotifyEvents(next.notifyDiscordEvents),
  );
  setSetting("spotifyClientId", next.spotifyClientId);
  setSetting("spotifyClientSecret", next.spotifyClientSecret);
  setSetting("geniusClientId", next.geniusClientId);
  setSetting("geniusClientSecret", next.geniusClientSecret);
  setSetting("geniusAccessToken", next.geniusAccessToken);
  setSetting("discordClientId", next.discordClientId);
  setSetting("discordClientSecret", next.discordClientSecret);
  setSetting("saveOnPlay", String(next.saveOnPlay));
  setSetting("libraryScanMinutes", String(next.libraryScanMinutes));
  return next;
}

export function smtpConfigured(settings?: Settings): boolean {
  const s = settings ?? getSettings();
  return Boolean(s.smtpHost.trim() && s.smtpFrom.trim() && s.smtpPort > 0);
}

/** Genius search works with access token (preferred) or public site search. */
export function geniusConfigured(settings?: Settings): boolean {
  const s = settings ?? getSettings();
  return Boolean(s.geniusAccessToken.trim());
}

export function getEmailTemplates(): EmailTemplatesMap {
  return parseEmailTemplatesJson(getSetting("emailTemplates", ""));
}

export function saveEmailTemplates(
  templates: EmailTemplatesMap,
): EmailTemplatesMap {
  setSetting("emailTemplates", serializeEmailTemplateOverrides(templates));
  return getEmailTemplates();
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export function hasUsers(): boolean {
  return countUsers() > 0;
}

export function countUsers(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM users`)
    .get() as { c: number };
  return row.c;
}

export function countAdmins(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM users
       WHERE role IN ('admin', 'owner') OR is_admin = 1`,
    )
    .get() as { c: number };
  return row.c;
}

export function countOwners(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'owner'`)
    .get() as { c: number };
  return row.c;
}

export function getServerOwnerId(): string | null {
  const row = getDb()
    .prepare(
      `SELECT id FROM users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

function adminBit(role: UserRole): number {
  return role === "owner" || role === "admin" ? 1 : 0;
}

function readUserRole(row: {
  role: string | null;
  isAdmin: number;
}): UserRole {
  if (row.role && isUserRole(row.role)) return row.role;
  return row.isAdmin ? "admin" : "member";
}

export function createUser(
  username: string,
  password: string,
  options?: { isAdmin?: boolean; role?: UserRole },
) {
  const id = newId();
  const role: UserRole =
    options?.role || (options?.isAdmin ? "admin" : "member");
  const isAdmin = adminBit(role);
  getDb()
    .prepare(
      `INSERT INTO users(id, username, password_hash, is_admin, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, username, hashPassword(password), isAdmin, role, nowIso());
  return {
    id,
    username,
    isAdmin: Boolean(isAdmin),
    role,
  };
}

export function createAdminUser(
  username: string,
  password: string,
  email: string,
) {
  if (hasUsers()) throw new Error("Admin account already exists");
  // First account is always Server Owner
  const user = createUser(username, password, { role: "owner" });
  const mail = updateUserEmail(user.id, email);
  if (!mail.ok) {
    // Roll back empty install if email invalid
    getDb().prepare(`DELETE FROM users WHERE id = ?`).run(user.id);
    throw new Error(mail.error);
  }
  updateSettings({ setupComplete: true });
  return { ...user, email: mail.email };
}

export function setUserAdmin(userId: string, isAdmin: boolean) {
  return setUserRole(userId, isAdmin ? "admin" : "member");
}

/**
 * Assign member / moderator / admin.
 * Cannot create a second owner, cannot demote the Server Owner
 * (use transferServerOwnership for that).
 */
export function setUserRole(userId: string, role: UserRole) {
  if (role === "owner") {
    throw new Error(
      "Use ownership transfer to assign Server Owner (only one allowed)",
    );
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, role, is_admin as isAdmin, access_revoked_at as revokedAt
       FROM users WHERE id = ?`,
    )
    .get(userId) as
    | { id: string; role: string; isAdmin: number; revokedAt: string | null }
    | undefined;
  if (!row) throw new Error("User not found");
  if (row.revokedAt) throw new Error("User access has been revoked");

  const current = readUserRole(row);
  if (current === "owner") {
    throw new Error("Cannot change the Server Owner role; transfer ownership instead");
  }

  db.prepare(`UPDATE users SET role = ?, is_admin = ? WHERE id = ?`).run(
    role,
    adminBit(role),
    userId,
  );
  return getPublicProfileById(userId);
}

/**
 * Transfer Server Owner to another user. Previous owner becomes a regular member
 * (no admin panel access). Only callable by the current owner (checked by API).
 */
export function transferServerOwnership(
  currentOwnerId: string,
  newOwnerId: string,
) {
  if (!currentOwnerId || !newOwnerId) {
    throw new Error("Invalid ownership transfer");
  }
  if (currentOwnerId === newOwnerId) {
    throw new Error("You are already the Server Owner");
  }

  const db = getDb();
  const current = db
    .prepare(
      `SELECT id, role, is_admin as isAdmin, access_revoked_at as revokedAt
       FROM users WHERE id = ?`,
    )
    .get(currentOwnerId) as
    | { id: string; role: string; isAdmin: number; revokedAt: string | null }
    | undefined;
  if (!current) throw new Error("Current owner not found");
  if (readUserRole(current) !== "owner") {
    throw new Error("Only the Server Owner can transfer ownership");
  }

  const target = db
    .prepare(
      `SELECT id, role, is_admin as isAdmin, access_revoked_at as revokedAt
       FROM users WHERE id = ?`,
    )
    .get(newOwnerId) as
    | { id: string; role: string; isAdmin: number; revokedAt: string | null }
    | undefined;
  if (!target) throw new Error("User not found");
  if (target.revokedAt) {
    throw new Error("Cannot transfer ownership to a revoked user");
  }

  const txn = db.transaction(() => {
    // Demote previous owner to plain member (no admin / moderator).
    db.prepare(
      `UPDATE users SET role = 'member', is_admin = 0 WHERE id = ?`,
    ).run(currentOwnerId);
    // Exactly one owner
    db.prepare(
      `UPDATE users SET role = 'admin', is_admin = 1 WHERE role = 'owner'`,
    ).run();
    db.prepare(
      `UPDATE users SET role = 'owner', is_admin = 1, access_revoked_at = NULL
       WHERE id = ?`,
    ).run(newOwnerId);
  });
  txn();

  return getPublicProfileById(newOwnerId);
}

/** End access: wipe sessions, soft-block login. Cannot revoke Server Owner. */
export function revokeUserAccess(userId: string): { ok: true } {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, role, is_admin as isAdmin FROM users WHERE id = ?`,
    )
    .get(userId) as
    | { id: string; role: string; isAdmin: number }
    | undefined;
  if (!row) throw new Error("User not found");

  const role = readUserRole(row);
  if (role === "owner") {
    throw new Error("Cannot revoke the Server Owner; transfer ownership first");
  }

  const now = nowIso();
  // Keep invite row for audit (used_by → user); block login via access_revoked_at.
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  db.prepare(
    `UPDATE users SET access_revoked_at = ?, role = 'member', is_admin = 0
     WHERE id = ?`,
  ).run(now, userId);
  return { ok: true };
}

/** Clear access block so the user can sign in again with existing credentials. */
export function restoreUserAccess(userId: string): { ok: true } {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, access_revoked_at as accessRevokedAt FROM users WHERE id = ?`,
    )
    .get(userId) as
    | { id: string; accessRevokedAt: string | null }
    | undefined;
  if (!row) throw new Error("User not found");
  if (!row.accessRevokedAt) {
    throw new Error("User access is not revoked");
  }
  db.prepare(
    `UPDATE users SET access_revoked_at = NULL WHERE id = ?`,
  ).run(userId);
  return { ok: true };
}

export function recordUserClientInfo(
  userId: string,
  info: { ip?: string | null; hwid?: string | null },
  sessionToken?: string | null,
) {
  if (!userId) return;
  const ip = (info.ip || "").trim().slice(0, 64) || null;
  const hwid = (info.hwid || "").trim().slice(0, 128) || null;
  if (!ip && !hwid) return;
  const db = getDb();
  if (ip || hwid) {
    db.prepare(
      `UPDATE users SET
         last_ip = COALESCE(?, last_ip),
         last_hwid = COALESCE(?, last_hwid)
       WHERE id = ?`,
    ).run(ip, hwid, userId);
  }
  if (sessionToken && (ip || hwid)) {
    db.prepare(
      `UPDATE sessions SET
         ip = COALESCE(?, ip),
         hwid = COALESCE(?, hwid)
       WHERE token = ?`,
    ).run(ip, hwid, sessionToken);
  }
}

export function getAdminUserDetail(userId: string) {
  const profile = getPublicProfileById(userId);
  if (!profile) return null;

  const row = getDb()
    .prepare(
      `SELECT email, last_ip as lastIp, last_hwid as lastHwid,
              access_revoked_at as accessRevokedAt,
              discord_id as discordId, discord_username as discordUsername,
              discord_display_name as discordDisplayName
       FROM users WHERE id = ?`,
    )
    .get(userId) as
    | {
        email: string | null;
        lastIp: string | null;
        lastHwid: string | null;
        accessRevokedAt: string | null;
        discordId: string | null;
        discordUsername: string | null;
        discordDisplayName: string | null;
      }
    | undefined;

  const invite = getDb()
    .prepare(
      `SELECT id, code, emailed_to as emailedTo, used_at as usedAt,
              created_at as createdAt
       FROM invites WHERE used_by = ? ORDER BY used_at DESC LIMIT 1`,
    )
    .get(userId) as
    | {
        id: string;
        code: string;
        emailedTo: string | null;
        usedAt: string | null;
        createdAt: string;
      }
    | undefined;

  const discordId = (row?.discordId || "").trim() || null;
  const discordUsername = discordId
    ? (row?.discordUsername || "").trim() || null
    : null;
  const discordDisplayName = discordId
    ? (row?.discordDisplayName || "").trim() || discordUsername
    : null;

  return {
    ...profile,
    email: (row?.email || "").trim() || null,
    lastIp: (row?.lastIp || "").trim() || null,
    lastHwid: (row?.lastHwid || "").trim() || null,
    accessRevokedAt: row?.accessRevokedAt || null,
    discordId,
    discordUsername,
    discordDisplayName,
    invite: invite
      ? {
          id: invite.id,
          code: invite.code,
          emailedTo: invite.emailedTo,
          usedAt: invite.usedAt,
          createdAt: invite.createdAt,
        }
      : null,
  };
}

export function getPublicProfileById(id: string): PublicProfile | null {
  const row = getDb()
    .prepare(`${PROFILE_SELECT} WHERE id = ? LIMIT 1`)
    .get(id) as UserProfileRow | undefined;
  if (!row) return null;
  return mapPublicProfile(row);
}

/** Account email (private — not on public profiles). */
export function getUserEmail(userId: string): string | null {
  if (!userId) return null;
  const row = getDb()
    .prepare(`SELECT email FROM users WHERE id = ?`)
    .get(userId) as { email: string | null } | undefined;
  const email = (row?.email || "").trim();
  return email || null;
}

/**
 * Set account email (required). Must be unique among users (case-insensitive).
 */
export function updateUserEmail(
  userId: string,
  email: string,
): { ok: true; email: string } | { ok: false; error: string } {
  if (!userId) return { ok: false, error: "Unauthorized" };
  const next = email.trim().toLowerCase();
  if (!next) {
    return { ok: false, error: "Email is required" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next) || next.length > 255) {
    return { ok: false, error: "Enter a valid email address" };
  }
  const taken = getDb()
    .prepare(
      `SELECT id FROM users WHERE lower(email) = ? AND id != ? LIMIT 1`,
    )
    .get(next, userId) as { id: string } | undefined;
  if (taken) return { ok: false, error: "That email is already in use" };
  getDb()
    .prepare(`UPDATE users SET email = ? WHERE id = ?`)
    .run(next, userId);
  return { ok: true, email: next };
}

export function createEmailChangeToken(
  userId: string,
  email: string,
): { ok: true; token: string; email: string } | { ok: false; error: string } {
  const next = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next) || next.length > 255) {
    return { ok: false, error: "Enter a valid email address" };
  }
  const current = getUserEmail(userId);
  if (current?.toLowerCase() === next) {
    return { ok: false, error: "That is already your account email" };
  }
  const taken = getDb()
    .prepare(`SELECT id FROM users WHERE lower(email) = ? AND id != ? LIMIT 1`)
    .get(next, userId) as { id: string } | undefined;
  if (taken) return { ok: false, error: "That email is already in use" };

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + 60 * 60 * 1000);
  const db = getDb();
  db.prepare(
    `UPDATE email_changes SET used_at = ? WHERE user_id = ? AND used_at IS NULL`,
  ).run(now.toISOString(), userId);
  db.prepare(
    `INSERT INTO email_changes(
       id, user_id, email, token_hash, created_at, expires_at, used_at
     ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    randomBytes(16).toString("hex"),
    userId,
    next,
    tokenHash,
    now.toISOString(),
    expires.toISOString(),
  );
  return { ok: true, token, email: next };
}

export function confirmEmailChange(
  token: string,
): { ok: true; email: string } | { ok: false; error: string } {
  const tokenHash = createHash("sha256").update(token.trim()).digest("hex");
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id as userId, email, expires_at as expiresAt, used_at as usedAt
       FROM email_changes WHERE token_hash = ? LIMIT 1`,
    )
    .get(tokenHash) as
    | {
        id: string;
        userId: string;
        email: string;
        expiresAt: string;
        usedAt: string | null;
      }
    | undefined;
  if (!row || row.usedAt || Date.parse(row.expiresAt) <= Date.now()) {
    return { ok: false, error: "This email confirmation link is invalid or expired" };
  }
  const result = updateUserEmail(row.userId, row.email);
  if (!result.ok) return result;
  db.prepare(`UPDATE email_changes SET used_at = ? WHERE id = ?`).run(
    nowIso(),
    row.id,
  );
  return result;
}

export function updateUsername(
  userId: string,
  username: string,
): { ok: true; username: string } | { ok: false; error: string } {
  if (!userId) return { ok: false, error: "Unauthorized" };
  const next = username.trim();
  if (next.length < 1 || next.length > 40) {
    return { ok: false, error: "Username must be 1–40 characters" };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(next)) {
    return {
      ok: false,
      error: "Username can only use letters, numbers, dots, _ and -",
    };
  }
  const taken = getDb()
    .prepare(
      `SELECT id FROM users WHERE lower(username) = lower(?) AND id != ? LIMIT 1`,
    )
    .get(next, userId) as { id: string } | undefined;
  if (taken) return { ok: false, error: "That username is taken" };
  const prev = getDb()
    .prepare(`SELECT username FROM users WHERE id = ?`)
    .get(userId) as { username: string } | undefined;
  getDb()
    .prepare(`UPDATE users SET username = ? WHERE id = ?`)
    .run(next, userId);
  if (prev?.username && prev.username !== next) {
    getDb()
      .prepare(`UPDATE requests SET requested_by = ? WHERE requested_by = ?`)
      .run(next, prev.username);
  }
  return { ok: true, username: next };
}

export function updateUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): { ok: true } | { ok: false; error: string } {
  if (!userId) return { ok: false, error: "Unauthorized" };
  if (newPassword.length < 8 || newPassword.length > 128) {
    return { ok: false, error: "New password must be at least 8 characters" };
  }
  const row = getDb()
    .prepare(`SELECT password_hash as passwordHash FROM users WHERE id = ?`)
    .get(userId) as { passwordHash: string } | undefined;
  if (!row) return { ok: false, error: "User not found" };
  if (!verifyPassword(currentPassword, row.passwordHash)) {
    return { ok: false, error: "Current password is incorrect" };
  }
  getDb()
    .prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
    .run(hashPassword(newPassword), userId);
  return { ok: true };
}

/** Set password without knowing the current one (forgot-password flow). */
export function setUserPassword(
  userId: string,
  newPassword: string,
): { ok: true } | { ok: false; error: string } {
  if (!userId) return { ok: false, error: "Unauthorized" };
  if (newPassword.length < 8 || newPassword.length > 128) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }
  const exists = getDb()
    .prepare(`SELECT id FROM users WHERE id = ?`)
    .get(userId) as { id: string } | undefined;
  if (!exists) return { ok: false, error: "User not found" };
  getDb()
    .prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
    .run(hashPassword(newPassword), userId);
  // Force re-login everywhere after a reset
  getDb().prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  return { ok: true };
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Look up a user by account email. Must have an email on file to receive a reset link.
 */
export function findUserForPasswordReset(emailRaw: string): {
  id: string;
  username: string;
  email: string;
} | null {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  const row = getDb()
    .prepare(
      `SELECT id, username, email FROM users
       WHERE lower(email) = ? AND access_revoked_at IS NULL
       LIMIT 1`,
    )
    .get(email) as
    | { id: string; username: string; email: string | null }
    | undefined;
  const addr = (row?.email || "").trim();
  if (!row || !addr) return null;
  return { id: row.id, username: row.username, email: addr };
}

/** Create a one-time reset token (plain returned once; hash stored). Valid 1h. */
export function createPasswordResetToken(userId: string): string {
  const db = getDb();
  // Invalidate unused prior tokens for this user
  db.prepare(
    `UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL`,
  ).run(new Date().toISOString(), userId);

  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO password_resets(id, user_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    randomBytes(16).toString("hex"),
    userId,
    hashResetToken(token),
    now.toISOString(),
    expires.toISOString(),
  );
  return token;
}

/** Consume a reset token → user id, or null if invalid/expired/used. */
export function consumePasswordResetToken(token: string): string | null {
  const plain = (token || "").trim();
  if (!plain || plain.length < 32) return null;
  const hash = hashResetToken(plain);
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id as userId, expires_at as expiresAt, used_at as usedAt
       FROM password_resets WHERE token_hash = ? LIMIT 1`,
    )
    .get(hash) as
    | {
        id: string;
        userId: string;
        expiresAt: string;
        usedAt: string | null;
      }
    | undefined;
  if (!row || row.usedAt) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;
  db.prepare(`UPDATE password_resets SET used_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    row.id,
  );
  return row.userId;
}

/** Peek whether a token is still usable (for the reset form UI). */
export function passwordResetTokenValid(token: string): boolean {
  const plain = (token || "").trim();
  if (!plain || plain.length < 32) return false;
  const row = getDb()
    .prepare(
      `SELECT expires_at as expiresAt, used_at as usedAt
       FROM password_resets WHERE token_hash = ? LIMIT 1`,
    )
    .get(hashResetToken(plain)) as
    | { expiresAt: string; usedAt: string | null }
    | undefined;
  if (!row || row.usedAt) return false;
  return new Date(row.expiresAt).getTime() >= Date.now();
}

/** Check password for the given user (e.g. before revealing secrets in admin UI). */
export function verifyUserPassword(userId: string, password: string): boolean {
  if (!userId || !password) return false;
  const row = getDb()
    .prepare(`SELECT password_hash as passwordHash FROM users WHERE id = ?`)
    .get(userId) as { passwordHash: string } | undefined;
  if (!row?.passwordHash) return false;
  return verifyPassword(password, row.passwordHash);
}

export type DiscordLink = {
  discordId: string;
  /** Discord handle (username), without discriminator. */
  discordUsername: string;
  /** global_name, falling back to username. */
  discordDisplayName: string;
  /** Discord avatar hash, or null for default. */
  discordAvatar: string | null;
  /** CDN URL for the Discord avatar. */
  avatarUrl: string;
  presenceEnabled: boolean;
  /** When false, Discord login is blocked but the link remains. */
  loginEnabled: boolean;
};

export function discordAvatarUrl(
  discordId: string,
  avatarHash: string | null | undefined,
): string {
  const id = (discordId || "").trim();
  const hash = (avatarHash || "").trim();
  if (id && hash) {
    const ext = hash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}?size=128`;
  }
  let index = 0;
  try {
    if (id) index = Number((BigInt(id) >> BigInt(22)) % BigInt(6));
  } catch {
    index = 0;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function getDiscordLink(userId: string): DiscordLink | null {
  if (!userId) return null;
  const row = getDb()
    .prepare(
      `SELECT discord_id as discordId, discord_username as discordUsername,
              discord_display_name as discordDisplayName,
              discord_avatar as discordAvatar,
              discord_presence_enabled as presenceEnabled,
              discord_login_enabled as loginEnabled
       FROM users WHERE id = ?`,
    )
    .get(userId) as
    | {
        discordId: string | null;
        discordUsername: string | null;
        discordDisplayName: string | null;
        discordAvatar: string | null;
        presenceEnabled: number;
        loginEnabled: number | null;
      }
    | undefined;
  if (!row?.discordId) return null;
  const handle = (row.discordUsername || "").trim();
  const display =
    (row.discordDisplayName || "").trim() || handle || "Discord";
  return {
    discordId: row.discordId,
    discordUsername: handle || display,
    discordDisplayName: display,
    discordAvatar: (row.discordAvatar || "").trim() || null,
    avatarUrl: discordAvatarUrl(row.discordId, row.discordAvatar),
    presenceEnabled: Number(row.presenceEnabled) === 1,
    // Default true for rows created before the column existed.
    loginEnabled: row.loginEnabled == null ? true : Number(row.loginEnabled) === 1,
  };
}

export function setDiscordLink(
  userId: string,
  input: {
    discordId: string;
    discordUsername: string;
    discordDisplayName?: string | null;
    discordAvatar?: string | null;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
  },
) {
  const db = getDb();
  const handle = input.discordUsername.trim() || "Discord";
  const display =
    (input.discordDisplayName || "").trim() || handle;
  const avatar = (input.discordAvatar || "").trim() || null;
  // One Discord account → one Polarr user
  db.prepare(
    `UPDATE users SET
       discord_id = NULL,
       discord_username = NULL,
       discord_display_name = NULL,
       discord_avatar = NULL,
       discord_access_token = NULL,
       discord_refresh_token = NULL,
       discord_token_expires_at = NULL,
       discord_presence_enabled = 0,
       discord_login_enabled = 1
     WHERE discord_id = ? AND id != ?`,
  ).run(input.discordId, userId);
  db.prepare(
    `UPDATE users SET
       discord_id = ?,
       discord_username = ?,
       discord_display_name = ?,
       discord_avatar = ?,
       discord_access_token = ?,
       discord_refresh_token = ?,
       discord_token_expires_at = ?,
       discord_login_enabled = 1
     WHERE id = ?`,
  ).run(
    input.discordId,
    handle,
    display,
    avatar,
    input.accessToken,
    input.refreshToken,
    input.expiresAt,
    userId,
  );
}

/** Find Polarr user id that already linked this Discord account (login allowed). */
export function getUserIdByDiscordId(discordId: string): string | null {
  const id = (discordId || "").trim();
  if (!id) return null;
  const row = getDb()
    .prepare(
      `SELECT id, discord_login_enabled as loginEnabled FROM users
       WHERE discord_id = ? AND access_revoked_at IS NULL
       LIMIT 1`,
    )
    .get(id) as { id: string; loginEnabled: number | null } | undefined;
  if (!row) return null;
  if (row.loginEnabled != null && Number(row.loginEnabled) !== 1) return null;
  return row.id;
}

/**
 * Create a session for an existing user (password or Discord login).
 * Returns null if user missing / revoked.
 */
export function createSessionForUser(
  userId: string,
  client?: {
    ip?: string | null;
    hwid?: string | null;
    userAgent?: string | null;
  },
) {
  const row = getDb()
    .prepare(
      `SELECT id, username, is_admin as isAdmin, role,
              access_revoked_at as accessRevokedAt
       FROM users WHERE id = ?`,
    )
    .get(userId) as
    | {
        id: string;
        username: string;
        isAdmin: number;
        role: string | null;
        accessRevokedAt: string | null;
      }
    | undefined;
  if (!row || row.accessRevokedAt) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bans = require("./bans") as typeof import("./bans");
    const ban = bans.getActiveBan(row.id);
    if (ban?.user) {
      return {
        banned: true as const,
        banMessage: bans.banToastMessage(ban),
        expiresAt: ban.expiresAt,
        permanent: ban.expiresAt == null,
      };
    }
  } catch {
    /* migrate */
  }

  const role = resolveRole(row.role, row.isAdmin);
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);
  const ip = (client?.ip || "").trim().slice(0, 64) || null;
  const hwid = (client?.hwid || "").trim().slice(0, 128) || null;
  const userAgent = (client?.userAgent || "").trim().slice(0, 500) || null;
  getDb()
    .prepare(
      `INSERT INTO sessions(
         token, user_id, created_at, expires_at, ip, hwid, user_agent, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      token,
      row.id,
      now.toISOString(),
      expires.toISOString(),
      ip,
      hwid,
      userAgent,
      now.toISOString(),
    );
  recordUserClientInfo(row.id, { ip, hwid }, token);
  return {
    token,
    user: {
      id: row.id,
      username: row.username,
      isAdmin: role === "admin" || role === "owner",
      role,
    },
  };
}

export function clearDiscordLink(userId: string) {
  getDb()
    .prepare(
      `UPDATE users SET
         discord_id = NULL,
         discord_username = NULL,
         discord_display_name = NULL,
         discord_avatar = NULL,
         discord_access_token = NULL,
         discord_refresh_token = NULL,
         discord_token_expires_at = NULL,
         discord_presence_enabled = 0,
         discord_login_enabled = 1
       WHERE id = ?`,
    )
    .run(userId);
}

export function setDiscordPresenceEnabled(userId: string, enabled: boolean) {
  getDb()
    .prepare(`UPDATE users SET discord_presence_enabled = ? WHERE id = ?`)
    .run(enabled ? 1 : 0, userId);
}

export function getDiscordPresenceEnabled(userId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT discord_presence_enabled as enabled FROM users WHERE id = ?`,
    )
    .get(userId) as { enabled: number } | undefined;
  return Boolean(row?.enabled);
}

export function setDiscordLoginEnabled(userId: string, enabled: boolean) {
  getDb()
    .prepare(`UPDATE users SET discord_login_enabled = ? WHERE id = ?`)
    .run(enabled ? 1 : 0, userId);
}

/** Client ID is enough for local Rich Presence (Discord desktop RPC). */
export function discordPresenceAppConfigured(settings?: Settings): boolean {
  const s = settings ?? getSettings();
  return Boolean(s.discordClientId.trim());
}

export function discordOAuthConfigured(settings?: Settings): boolean {
  const s = settings ?? getSettings();
  return Boolean(s.discordClientId.trim() && s.discordClientSecret.trim());
}

/** Server Owner contact for admin ops (SMTP tests, etc.). */
export function getServerOwnerContact(): {
  id: string;
  username: string;
  email: string;
} | null {
  const row = getDb()
    .prepare(
      `SELECT id, username, email FROM users
       WHERE role = 'owner'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .get() as
    | { id: string; username: string; email: string | null }
    | undefined;
  if (row?.email?.trim()) {
    return {
      id: row.id,
      username: row.username,
      email: row.email.trim(),
    };
  }
  // Fallback: earliest admin with email (pre-owner migrations)
  const admin = getDb()
    .prepare(
      `SELECT id, username, email FROM users
       WHERE (role IN ('admin', 'owner') OR is_admin = 1)
         AND email IS NOT NULL AND trim(email) != ''
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .get() as
    | { id: string; username: string; email: string | null }
    | undefined;
  if (!admin?.email?.trim()) return null;
  return {
    id: admin.id,
    username: admin.username,
    email: admin.email.trim(),
  };
}

// ─── Invites ────────────────────────────────────────────────────────────────

export type InviteRow = {
  id: string;
  code: string;
  createdBy: string;
  createdByUsername?: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  usedBy: string | null;
  usedByUsername?: string | null;
  usedAt: string | null;
  emailedTo: string | null;
};

function mapInvite(row: {
  id: string;
  code: string;
  createdBy: string;
  createdByUsername?: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  usedBy: string | null;
  usedByUsername?: string | null;
  usedAt: string | null;
  emailedTo?: string | null;
}): InviteRow {
  return {
    id: row.id,
    code: row.code,
    createdBy: row.createdBy,
    createdByUsername: row.createdByUsername ?? undefined,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    usedBy: row.usedBy,
    usedByUsername: row.usedByUsername ?? null,
    usedAt: row.usedAt,
    emailedTo: row.emailedTo ?? null,
  };
}

function inviteCode(): string {
  const raw = randomBytes(5).toString("hex").toUpperCase();
  return `POLARR-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

const INVITE_SELECT = `SELECT i.id, i.code, i.created_by as createdBy, u.username as createdByUsername,
              i.created_at as createdAt, i.expires_at as expiresAt,
              i.revoked_at as revokedAt, i.used_by as usedBy,
              uu.username as usedByUsername, i.used_at as usedAt,
              i.emailed_to as emailedTo
       FROM invites i
       LEFT JOIN users u ON u.id = i.created_by
       LEFT JOIN users uu ON uu.id = i.used_by`;

export function createInvite(
  createdBy: string,
  options?: { expiresInDays?: number; emailedTo?: string | null },
): InviteRow {
  const id = newId();
  const code = inviteCode();
  const now = nowIso();
  const expiresInDays = options?.expiresInDays ?? 14;
  const expires =
    expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
  const emailedTo = options?.emailedTo?.trim() || null;
  getDb()
    .prepare(
      `INSERT INTO invites(id, code, created_by, created_at, expires_at, emailed_to)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, code, createdBy, now, expires, emailedTo);
  return getInviteById(id)!;
}

export function getInviteById(id: string): InviteRow | null {
  const row = getDb()
    .prepare(`${INVITE_SELECT} WHERE i.id = ?`)
    .get(id) as Parameters<typeof mapInvite>[0] | undefined;
  return row ? mapInvite(row) : null;
}

export function getInviteByCode(code: string): InviteRow | null {
  purgeRevokedInvites();
  const key = code.trim().toUpperCase();
  if (!key) return null;
  const row = getDb()
    .prepare(`${INVITE_SELECT} WHERE upper(i.code) = ?`)
    .get(key) as Parameters<typeof mapInvite>[0] | undefined;
  return row ? mapInvite(row) : null;
}

export function listInvites(limit = 100): InviteRow[] {
  purgeRevokedInvites();
  return (
    getDb()
      .prepare(
        `${INVITE_SELECT}
         WHERE i.revoked_at IS NULL
         ORDER BY i.created_at DESC LIMIT ?`,
      )
      .all(limit) as Parameters<typeof mapInvite>[0][]
  ).map(mapInvite);
}

export function inviteStatus(
  invite: InviteRow,
): "open" | "used" | "revoked" | "expired" {
  if (invite.revokedAt) return "revoked";
  if (invite.usedBy || invite.usedAt) return "used";
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    return "expired";
  }
  return "open";
}

/** Drop an open invite immediately — we don’t keep revoked codes. */
export function revokeInvite(id: string): InviteRow {
  const invite = getInviteById(id);
  if (!invite) throw new Error("Invite not found");
  if (inviteStatus(invite) !== "open") {
    throw new Error("Only open invites can be revoked");
  }
  deleteInvite(id);
  return invite;
}

export function deleteInvite(id: string) {
  getDb().prepare(`DELETE FROM invites WHERE id = ?`).run(id);
}

/** Remove any soft-revoked invite rows (legacy); revoke now deletes immediately. */
export function purgeRevokedInvites() {
  const result = getDb()
    .prepare(`DELETE FROM invites WHERE revoked_at IS NOT NULL`)
    .run();
  return result.changes;
}

/** @deprecated use purgeRevokedInvites */
export function purgeStaleRevokedInvites(_maxAgeMs?: number) {
  return purgeRevokedInvites();
}

export function redeemInvite(
  code: string,
  username: string,
  password: string,
  client?: { ip?: string | null; hwid?: string | null },
) {
  const invite = getInviteByCode(code);
  if (!invite) throw new Error("Invalid invite code");
  const status = inviteStatus(invite);
  if (status === "used") throw new Error("Invite already used");
  if (status === "revoked") throw new Error("Invite was revoked");
  if (status === "expired") throw new Error("Invite has expired");

  const user = createUser(username, password, { isAdmin: false });
  getDb()
    .prepare(`UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?`)
    .run(user.id, nowIso(), invite.id);
  if (invite.emailedTo?.trim()) {
    updateUserEmail(user.id, invite.emailedTo.trim());
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { notifyDiscord } =
      require("./admin-notify") as typeof import("./admin-notify");
    notifyDiscord("inviteUsed", {
      title: "Invite used",
      description: `${user.username} joined with invite ${invite.code}`,
      fields: [
        { name: "User", value: user.username, inline: true },
        {
          name: "Emailed to",
          value: invite.emailedTo?.trim() || "—",
          inline: true,
        },
        {
          name: "IP",
          value: (client?.ip || "").trim() || "unknown",
          inline: true,
        },
      ],
    });
  } catch {
    /* ignore */
  }
  return user;
}

export function authenticate(
  username: string,
  password: string,
  client?: {
    ip?: string | null;
    hwid?: string | null;
    userAgent?: string | null;
  },
) {
  const row = getDb()
    .prepare(
      `SELECT id, username, password_hash, is_admin as isAdmin, role,
              access_revoked_at as accessRevokedAt
       FROM users WHERE username = ?`,
    )
    .get(username) as
    | {
        id: string;
        username: string;
        password_hash: string;
        isAdmin: number;
        role: string | null;
        accessRevokedAt: string | null;
      }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  if (row.accessRevokedAt) return null;
  return createSessionForUser(row.id, client);
}

type AuthUser = {
  id: string;
  username: string;
  isAdmin: boolean;
  role: UserRole;
};

/** Short TTL cache — media Range requests re-auth on every chunk. */
const tokenUserCache = new Map<
  string,
  { at: number; user: AuthUser | null }
>();
const TOKEN_USER_TTL_MS = 5_000;
const tokenLastSeenWrite = new Map<string, number>();
const SESSION_LAST_SEEN_WRITE_MS = 60_000;

function touchSession(token: string) {
  const now = Date.now();
  const previous = tokenLastSeenWrite.get(token) ?? 0;
  if (now - previous < SESSION_LAST_SEEN_WRITE_MS) return;
  tokenLastSeenWrite.set(token, now);
  getDb()
    .prepare(`UPDATE sessions SET last_seen_at = ? WHERE token = ?`)
    .run(new Date(now).toISOString(), token);
}

export function getUserByToken(token: string | null | undefined) {
  if (!token) return null;
  const cached = tokenUserCache.get(token);
  if (cached && Date.now() - cached.at < TOKEN_USER_TTL_MS) {
    if (cached.user) touchSession(token);
    return cached.user;
  }
  const row = getDb()
    .prepare(
      `SELECT u.id, u.username, u.is_admin as isAdmin, u.role,
              u.access_revoked_at as accessRevokedAt, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as
    | {
        id: string;
        username: string;
        isAdmin: number;
        role: string | null;
        accessRevokedAt: string | null;
        expires_at: string;
      }
    | undefined;
  if (!row) {
    tokenUserCache.set(token, { at: Date.now(), user: null });
    return null;
  }
  if (row.accessRevokedAt) {
    tokenUserCache.set(token, { at: Date.now(), user: null });
    return null;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    tokenUserCache.set(token, { at: Date.now(), user: null });
    return null;
  }
  // Full user bans kill the session immediately (lazy check)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getActiveBan } = require("./bans") as typeof import("./bans");
    const ban = getActiveBan(row.id);
    if (ban?.user) {
      tokenUserCache.set(token, { at: Date.now(), user: null });
      return null;
    }
  } catch {
    /* ignore circular init */
  }
  const role = resolveRole(row.role, row.isAdmin);
  const user: AuthUser = {
    id: row.id,
    username: row.username,
    isAdmin: role === "admin" || role === "owner",
    role,
  };
  tokenUserCache.set(token, { at: Date.now(), user });
  touchSession(token);
  return user;
}

function sessionPublicId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}

function sessionDeviceName(userAgent: string | null): string {
  const ua = userAgent || "";
  if (/Edg\//i.test(ua)) return "Web Player (Edge)";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "Web Player (Chrome)";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Web Player (Safari)";
  if (/Firefox\//i.test(ua)) return "Web Player (Firefox)";
  return "Polarr session";
}

export function getAdminUserSessions(userId: string, currentToken?: string | null) {
  const rows = getDb()
    .prepare(
      `SELECT token, created_at as createdAt, expires_at as expiresAt,
              last_seen_at as lastSeenAt, ip, hwid, user_agent as userAgent
       FROM sessions WHERE user_id = ? ORDER BY COALESCE(last_seen_at, created_at) DESC`,
    )
    .all(userId) as {
      token: string;
      createdAt: string;
      expiresAt: string;
      lastSeenAt: string | null;
      ip: string | null;
      hwid: string | null;
      userAgent: string | null;
    }[];
  return rows.map((row) => ({
    id: sessionPublicId(row.token),
    device: sessionDeviceName(row.userAgent),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt || row.createdAt,
    ip: (row.ip || "").trim() || null,
    deviceId: (row.hwid || "").trim() || null,
    current: Boolean(currentToken && row.token === currentToken),
  }));
}

export function revokeAdminUserSession(userId: string, publicSessionId: string): boolean {
  const rows = getDb()
    .prepare(`SELECT token FROM sessions WHERE user_id = ?`)
    .all(userId) as { token: string }[];
  const match = rows.find((row) => sessionPublicId(row.token) === publicSessionId);
  if (!match) return false;
  getDb().prepare(`DELETE FROM sessions WHERE token = ? AND user_id = ?`).run(match.token, userId);
  tokenUserCache.delete(match.token);
  tokenLastSeenWrite.delete(match.token);
  return true;
}

function resolveRole(
  role: string | null | undefined,
  isAdmin: number,
): UserRole {
  if (role && isUserRole(role)) return role;
  return isAdmin ? "admin" : "member";
}

import { scrambleUserId } from "./user-id";

export type PublicProfile = {
  id: string;
  publicId: string;
  username: string;
  isAdmin: boolean;
  role: UserRole;
  createdAt: string;
  avatarUrl: string | null;
  bannerColors: string[] | null;
};

type UserProfileRow = {
  id: string;
  username: string;
  isAdmin: number;
  role?: string | null;
  createdAt: string;
  avatarPath?: string | null;
  bannerColors?: string | null;
};

function parseBannerColors(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((c) => typeof c === "string")
    ) {
      return parsed as string[];
    }
  } catch {
    /* ignore */
  }
  return null;
}

function mapPublicProfile(row: UserProfileRow): PublicProfile {
  const publicId = scrambleUserId(row.id);
  const role = resolveRole(row.role, row.isAdmin);
  // File must still resolve (DB path may be a stale absolute after data-dir move)
  const hasAvatar = Boolean(getUserAvatarPath(row.id));
  return {
    id: row.id,
    publicId,
    username: row.username,
    isAdmin: role === "admin" || role === "owner",
    role,
    createdAt: row.createdAt,
    avatarUrl: hasAvatar
      ? `/api/profiles/avatar/${encodeURIComponent(publicId)}`
      : null,
    bannerColors: parseBannerColors(row.bannerColors),
  };
}

const PROFILE_SELECT = `SELECT id, username, is_admin as isAdmin, role, created_at as createdAt,
  avatar_path as avatarPath, banner_colors as bannerColors FROM users`;

const AVATAR_EXTS = ["jpg", "jpeg", "png", "webp", "gif"] as const;

/**
 * Resolve avatar file on disk.
 * Prefer current data/avatars/{userId}.ext — absolute paths in the DB break
 * when POLARR_DATA_DIR / project layout changes (common broken-image cause).
 */
export function getUserAvatarPath(userId: string): string | null {
  const id = userId.trim();
  if (!id) return null;

  const row = getDb()
    .prepare(`SELECT avatar_path as avatarPath FROM users WHERE id = ?`)
    .get(id) as { avatarPath: string | null } | undefined;

  const dir = avatarsDir();
  const tries: string[] = [];
  const stored = row?.avatarPath?.trim();
  if (stored) {
    tries.push(stored);
    tries.push(path.join(dir, path.basename(stored)));
    if (!path.isAbsolute(stored)) tries.push(path.join(dir, stored));
  }
  for (const ext of AVATAR_EXTS) {
    tries.push(path.join(dir, `${id}.${ext}`));
  }

  const seen = new Set<string>();
  for (const candidate of tries) {
    const abs = path.resolve(candidate);
    if (seen.has(abs)) continue;
    seen.add(abs);
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    // Heal DB to a portable relative name under avatarsDir
    const healed = path.basename(abs);
    if (stored !== healed && path.resolve(path.join(dir, healed)) === abs) {
      try {
        getDb()
          .prepare(`UPDATE users SET avatar_path = ? WHERE id = ?`)
          .run(healed, id);
      } catch {
        /* best-effort */
      }
    }
    return abs;
  }

  return null;
}

export function setUserAvatar(
  userId: string,
  avatarPath: string | null,
  bannerColors: string[] | null,
) {
  // Store basename so moves of POLARR_DATA_DIR keep working
  const stored = avatarPath ? path.basename(avatarPath) : null;
  getDb()
    .prepare(
      `UPDATE users SET avatar_path = ?, banner_colors = ? WHERE id = ?`,
    )
    .run(
      stored,
      bannerColors ? JSON.stringify(bannerColors) : null,
      userId,
    );
  return getPublicProfileById(userId);
}

/* ── lyrics session cache ─────────────────────────────────────────────────── */

export type LyricsCacheRow = {
  cacheKey: string;
  artist: string;
  title: string;
  quality: string;
  source: string;
  externalId: string | null;
  sourceDurationSec: number | null;
  linesJson: string;
  offsetSec: number;
  offsetUserSet: boolean;
  fetchedAt: string;
  alignedJson: string | null;
  alignedFingerprint: string | null;
  /** Genius section structure JSON for duet sides (optional). */
  geniusJson: string | null;
};

export function getLyricsCache(cacheKey: string): LyricsCacheRow | null {
  const row = getDb()
    .prepare(
      `SELECT cache_key as cacheKey, artist, title, quality, source,
              external_id as externalId, source_duration_sec as sourceDurationSec,
              lines_json as linesJson, offset_sec as offsetSec,
              coalesce(offset_user_set, 0) as offsetUserSet,
              fetched_at as fetchedAt,
              aligned_json as alignedJson,
              aligned_fingerprint as alignedFingerprint,
              genius_json as geniusJson
       FROM lyrics_cache WHERE cache_key = ?`,
    )
    .get(cacheKey) as
    | (Omit<LyricsCacheRow, "offsetUserSet"> & {
        offsetUserSet: number;
      })
    | undefined;
  if (!row) return null;
  return {
    ...row,
    offsetUserSet: Boolean(row.offsetUserSet),
    alignedJson: row.alignedJson ?? null,
    alignedFingerprint: row.alignedFingerprint ?? null,
    geniusJson: row.geniusJson ?? null,
  };
}

/**
 * Upsert lyrics document. Does not clear a user-chosen offset
 * unless `offsetSec` + `offsetUserSet` are provided.
 */
export function setLyricsCache(input: {
  cacheKey: string;
  artist: string;
  title: string;
  quality: string;
  source: string;
  externalId: string | null;
  sourceDurationSec: number | null;
  linesJson: string;
  geniusJson?: string | null;
}): void {
  const geniusJson =
    input.geniusJson === undefined ? undefined : input.geniusJson;
  getDb()
    .prepare(
      `INSERT INTO lyrics_cache(
         cache_key, artist, title, quality, source, external_id,
         source_duration_sec, lines_json, offset_sec, offset_user_set, fetched_at,
         genius_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         quality = excluded.quality,
         source = excluded.source,
         external_id = excluded.external_id,
         source_duration_sec = excluded.source_duration_sec,
         lines_json = excluded.lines_json,
         fetched_at = excluded.fetched_at,
         aligned_json = NULL,
         aligned_fingerprint = NULL,
         genius_json = CASE
           WHEN excluded.genius_json IS NOT NULL THEN excluded.genius_json
           ELSE lyrics_cache.genius_json
         END`,
    )
    .run(
      input.cacheKey,
      input.artist,
      input.title,
      input.quality,
      input.source,
      input.externalId,
      input.sourceDurationSec,
      input.linesJson,
      nowIso(),
      geniusJson ?? null,
    );
}

export function setLyricsCacheGenius(
  cacheKey: string,
  geniusJson: string | null,
): void {
  getDb()
    .prepare(`UPDATE lyrics_cache SET genius_json = ? WHERE cache_key = ?`)
    .run(geniusJson, cacheKey);
}

export function setLyricsCacheOffset(
  cacheKey: string,
  offsetSec: number,
  userSet = true,
): void {
  getDb()
    .prepare(
      `UPDATE lyrics_cache SET offset_sec = ?, offset_user_set = ? WHERE cache_key = ?`,
    )
    .run(offsetSec, userSet ? 1 : 0, cacheKey);
}

/** Persist DTW-aligned line times. Does not touch the original LRC `lines_json`. */
export function setLyricsCacheAligned(
  cacheKey: string,
  alignedJson: string,
  fingerprint: string,
): void {
  getDb()
    .prepare(
      `UPDATE lyrics_cache
       SET aligned_json = ?, aligned_fingerprint = ?
       WHERE cache_key = ?`,
    )
    .run(alignedJson, fingerprint, cacheKey);
}

/** Public profile listing (no secrets) — visible to all homeserver users. */
export function listPublicProfiles(): PublicProfile[] {
  return (
    getDb()
      .prepare(`${PROFILE_SELECT} ORDER BY created_at ASC`)
      .all() as UserProfileRow[]
  ).map(mapPublicProfile);
}

export function getPublicProfile(username: string): PublicProfile | null {
  const key = username.trim();
  if (!key) return null;
  const row = getDb()
    .prepare(`${PROFILE_SELECT} WHERE lower(username) = lower(?) LIMIT 1`)
    .get(key) as UserProfileRow | undefined;
  if (!row) return null;
  return mapPublicProfile(row);
}

/** Case-insensitive username search for global search / profile discovery. */
export function searchPublicProfiles(
  query: string,
  limit = 12,
): PublicProfile[] {
  const q = query.trim().replace(/^@+/, "");
  if (!q) return [];
  const lim = Math.min(40, Math.max(1, Math.floor(limit)));
  const safe = q.replace(/[%_]/g, "");
  if (!safe) return [];
  const like = `%${safe}%`;
  const prefix = `${safe}%`;
  const rows = getDb()
    .prepare(
      `${PROFILE_SELECT}
       WHERE lower(username) LIKE lower(?)
         AND (access_revoked_at IS NULL OR trim(access_revoked_at) = '')
       ORDER BY
         CASE WHEN lower(username) = lower(?) THEN 0
              WHEN lower(username) LIKE lower(?) THEN 1
              ELSE 2 END,
         lower(username) ASC
       LIMIT ?`,
    )
    .all(like, q, prefix, lim) as UserProfileRow[];
  return rows.map(mapPublicProfile);
}

/**
 * Sidecar / embedded artwork wrongly indexed as tracks (title or path stem
 * like cover.jpg). Keep out of every library listing.
 * @param alias table alias with trailing dot, e.g. "t." — or "" for bare tracks.
 */
function notArtworkTrackSql(alias = ""): string {
  const c = alias;
  return `NOT (
  lower(trim(${c}title)) IN (
    'cover.jpg','cover.jpeg','cover.png','cover.webp','cover.gif',
    'folder.jpg','folder.jpeg','folder.png','front.jpg','front.jpeg',
    'back.jpg','albumart.jpg','albumart.jpeg','albumart.png',
    'thumb.jpg','thumbnail.jpg','artwork.jpg','artwork.png','r-cover.jpg'
  )
  OR lower(trim(${c}title)) GLOB 'cover*.jp*g'
  OR lower(trim(${c}title)) GLOB 'cover*.png'
  OR lower(trim(${c}title)) GLOB 'cover*.webp'
  OR lower(trim(${c}title)) GLOB 'folder*.jp*g'
  OR lower(trim(${c}title)) GLOB 'folder*.png'
  OR lower(trim(${c}title)) GLOB 'front*.jp*g'
  OR lower(trim(${c}title)) GLOB 'back*.jp*g'
  OR lower(trim(${c}title)) GLOB 'albumart*.jp*g'
  OR lower(trim(${c}title)) GLOB 'album?art*.jp*g'
  OR lower(trim(${c}title)) GLOB 'thumb*.jp*g'
  OR lower(trim(${c}title)) GLOB 'thumbnail*.jp*g'
  OR lower(trim(${c}title)) GLOB 'artwork*.jp*g'
  OR lower(trim(${c}title)) GLOB 'artwork*.png'
  OR lower(${c}path) GLOB '*[/\\\\]cover.jp*g'
  OR lower(${c}path) GLOB '*[/\\\\]folder.jp*g'
  OR lower(${c}path) GLOB '*[/\\\\]cover.jp*g.*'
  OR lower(${c}path) GLOB '*[/\\\\]folder.jp*g.*'
)`;
}

/** Real library files only — excludes stream history stubs used for Recently played. */
const LIBRARY_TRACK_FILTER = `source != 'stream' AND path NOT LIKE 'stream:%' AND path NOT LIKE 'stream://%' AND ${notArtworkTrackSql()}`;

/** Stream stubs + library, still hide artwork-named junk. */
const NON_ARTWORK_TRACK_FILTER = notArtworkTrackSql();
const NON_ARTWORK_TRACK_FILTER_T = notArtworkTrackSql("t.");

/** Artist frequency from shared library — used on public profiles. */
export function topArtistsFromLibrary(limit = 12): {
  artist: string;
  tracks: number;
}[] {
  return getDb()
    .prepare(
      `SELECT artist as artist, COUNT(*) as tracks
       FROM tracks
       WHERE artist IS NOT NULL AND trim(artist) != ''
         AND ${LIBRARY_TRACK_FILTER}
       GROUP BY lower(artist)
       ORDER BY tracks DESC, artist ASC
       LIMIT ?`,
    )
    .all(limit) as { artist: string; tracks: number }[];
}

/**
 * Artists ranked by household listening (≥15s plays).
 * Includes stream stubs so live listens count — not Lidarr-only.
 */
export function topArtistsFromListening(limit = 24): {
  artist: string;
  plays: number;
}[] {
  return getDb()
    .prepare(
      `SELECT t.artist as artist, COUNT(*) as plays
       FROM play_history p
       INNER JOIN tracks t ON t.id = p.track_id
       WHERE t.artist IS NOT NULL AND trim(t.artist) != ''
         AND (p.listened_seconds IS NULL OR p.listened_seconds >= 15)
       GROUP BY lower(t.artist)
       ORDER BY plays DESC, artist ASC
       LIMIT ?`,
    )
    .all(limit) as { artist: string; plays: number }[];
}

/** Recent / top tracks for public profile lists. */
export function topTracksFromLibrary(limit = 10): TrackRow[] {
  return (
    getDb()
      .prepare(
        `${TRACK_SELECT}
         WHERE ${LIBRARY_TRACK_FILTER}
         ORDER BY mtime_ms DESC, added_at DESC
         LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[]
  ).map(mapTrack);
}

/** Start of the current UTC calendar month as ISO (for “this month” profile stats). */
export function startOfUtcMonthIso(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01T00:00:00.000Z`;
}

/**
 * Top tracks for a user from their listening (≥15s), ranked by play count.
 * Defaults to the current UTC month to match profile “Top tracks this month”.
 */
export function topTracksForUser(
  userId: string,
  limit = 10,
  opts?: { sinceIso?: string | null },
): (TrackRow & { plays: number })[] {
  if (!userId) return [];
  const lim = Math.min(100, Math.max(1, Math.floor(limit)));
  const since =
    opts?.sinceIso === null
      ? null
      : (opts?.sinceIso ?? startOfUtcMonthIso());
  const rows = since
    ? (getDb()
        .prepare(
          `SELECT t.id, t.title, t.artist, t.album, t.duration, t.path,
                  t.cover_path as coverPath, t.source, t.external_id as externalId,
                  t.file_size as fileSize, t.mtime_ms as mtimeMs,
                  t.added_at as addedAt, t.updated_at as updatedAt,
                  COUNT(*) as plays
           FROM play_history p
           INNER JOIN tracks t ON t.id = p.track_id
           WHERE p.user_id = ?
             AND (p.listened_seconds IS NULL OR p.listened_seconds >= 15)
             AND p.played_at >= ?
           GROUP BY p.track_id
           ORDER BY plays DESC, MAX(p.played_at) DESC
           LIMIT ?`,
        )
        .all(userId, since, lim) as Record<string, unknown>[])
    : (getDb()
        .prepare(
          `SELECT t.id, t.title, t.artist, t.album, t.duration, t.path,
                  t.cover_path as coverPath, t.source, t.external_id as externalId,
                  t.file_size as fileSize, t.mtime_ms as mtimeMs,
                  t.added_at as addedAt, t.updated_at as updatedAt,
                  COUNT(*) as plays
           FROM play_history p
           INNER JOIN tracks t ON t.id = p.track_id
           WHERE p.user_id = ?
             AND (p.listened_seconds IS NULL OR p.listened_seconds >= 15)
           GROUP BY p.track_id
           ORDER BY plays DESC, MAX(p.played_at) DESC
           LIMIT ?`,
        )
        .all(userId, lim) as Record<string, unknown>[]);

  return rows.map((row) => ({
    ...mapTrack(row),
    plays: Number(row.plays) || 0,
  }));
}

/** Albums the user has actually listened to recently (not the whole server catalog). */
export function recentAlbumsForUser(
  userId: string,
  limit = 14,
): {
  title: string;
  artist: string;
  tracks: number;
  coverPath: string | null;
  playedAt: string;
}[] {
  if (!userId) return [];
  const lim = Math.min(40, Math.max(1, Math.floor(limit)));
  return getDb()
    .prepare(
      `SELECT t.album as title,
              t.artist as artist,
              COUNT(DISTINCT t.id) as tracks,
              MAX(CASE
                WHEN t.cover_path IS NOT NULL AND trim(t.cover_path) != ''
                THEN t.cover_path END) as coverPath,
              MAX(p.played_at) as playedAt
       FROM play_history p
       INNER JOIN tracks t ON t.id = p.track_id
       WHERE p.user_id = ?
         AND (p.listened_seconds IS NULL OR p.listened_seconds >= 15)
         AND t.album IS NOT NULL AND trim(t.album) != ''
       GROUP BY lower(t.artist), lower(t.album)
       ORDER BY playedAt DESC
       LIMIT ?`,
    )
    .all(userId, lim) as {
    title: string;
    artist: string;
    tracks: number;
    coverPath: string | null;
    playedAt: string;
  }[];
}

/** Activity stats for a public profile (not shared Lidarr catalog size). */
export function userProfileStats(userId: string): {
  playlists: number;
  liked: number;
  playsThisMonth: number;
  uniqueTracksThisMonth: number;
} {
  if (!userId) {
    return {
      playlists: 0,
      liked: 0,
      playsThisMonth: 0,
      uniqueTracksThisMonth: 0,
    };
  }
  const since = startOfUtcMonthIso();
  const playlists = (
    getDb()
      .prepare(`SELECT COUNT(*) as c FROM playlists WHERE user_id = ?`)
      .get(userId) as { c: number }
  ).c;
  const liked = countLikedTracks(userId);
  const playRow = getDb()
    .prepare(
      `SELECT COUNT(*) as plays,
              COUNT(DISTINCT track_id) as uniq
       FROM play_history
       WHERE user_id = ?
         AND (listened_seconds IS NULL OR listened_seconds >= 15)
         AND played_at >= ?`,
    )
    .get(userId, since) as { plays: number; uniq: number };
  return {
    playlists: Number(playlists) || 0,
    liked: Number(liked) || 0,
    playsThisMonth: Number(playRow?.plays) || 0,
    uniqueTracksThisMonth: Number(playRow?.uniq) || 0,
  };
}

/** Sidebar: albums listed like Spotify library (recent-ish by max mtime). */
export function listLibraryNavItems(limit = 40): {
  type: "album" | "playlist";
  key: string;
  title: string;
  artist: string;
  tracks: number;
  image: string | null;
}[] {
  const albums = getDb()
    .prepare(
      `SELECT album as title,
              artist as artist,
              COUNT(*) as tracks,
              MAX(mtime_ms) as mtime,
              MAX(CASE
                WHEN cover_path IS NOT NULL AND trim(cover_path) != ''
                THEN cover_path END) as image
       FROM tracks
       WHERE album IS NOT NULL AND trim(album) != ''
         AND ${LIBRARY_TRACK_FILTER}
       GROUP BY lower(artist), lower(album)
       ORDER BY mtime DESC, title ASC
       LIMIT ?`,
    )
    .all(limit) as {
    title: string;
    artist: string;
    tracks: number;
    mtime: number;
    image: string | null;
  }[];

  return albums.map((a) => ({
    type: "album" as const,
    key: `${a.artist}::${a.title}`.toLowerCase(),
    title: a.title,
    artist: a.artist || "Unknown artist",
    tracks: a.tracks,
    image: a.image || null,
  }));
}

/** Stable key for sidebar album pins. */
export function libraryAlbumPinKey(artist: string, album: string): string {
  return `album:${artist.trim().toLowerCase()}::${album.trim().toLowerCase()}`;
}

function parseLibraryAlbumPinKey(
  itemKey: string,
): { artist: string; album: string } | null {
  if (!itemKey.startsWith("album:")) return null;
  const rest = itemKey.slice("album:".length);
  const sep = rest.indexOf("::");
  if (sep < 0) return null;
  const artist = rest.slice(0, sep);
  const album = rest.slice(sep + 2);
  if (!artist || !album) return null;
  return { artist, album };
}

/**
 * Artists in *this user's* library (liked songs + pinned albums) — not the
 * full scanned catalog. Used by Your Library → Artists on mobile.
 */
export function topArtistsFromUserLibrary(
  userId: string,
  limit = 200,
): { artist: string; tracks: number }[] {
  if (!userId) return [];
  const counts = new Map<string, { artist: string; tracks: number }>();
  const add = (artist: string, n = 1) => {
    const name = artist.trim();
    if (!name) return;
    const key = name.toLowerCase();
    const prev = counts.get(key);
    if (prev) prev.tracks += n;
    else counts.set(key, { artist: name, tracks: n });
  };

  const liked = getDb()
    .prepare(
      `SELECT coalesce(nullif(t.artist, ''), nullif(l.artist, ''), '') as artist,
              COUNT(*) as tracks
       FROM track_likes l
       LEFT JOIN tracks t ON t.id = l.track_id
       WHERE l.user_id = ?
       GROUP BY lower(coalesce(nullif(t.artist, ''), nullif(l.artist, ''), ''))`,
    )
    .all(userId) as { artist: string; tracks: number }[];
  for (const row of liked) add(row.artist, Number(row.tracks) || 0);

  for (const pin of listLibraryPins(userId)) {
    const parsed = parseLibraryAlbumPinKey(pin.itemKey);
    if (parsed?.artist) add(parsed.artist, 1);
  }

  return [...counts.values()]
    .filter((r) => r.artist)
    .sort(
      (a, b) => b.tracks - a.tracks || a.artist.localeCompare(b.artist),
    )
    .slice(0, limit);
}

/**
 * Albums/tracks this user saved into their library (pins + likes) — not the
 * shared scanned catalog size.
 */
export function userPersonalLibraryStats(userId: string): {
  albums: number;
  tracks: number;
} {
  if (!userId) return { albums: 0, tracks: 0 };

  const wanted: { artist: string; album: string }[] = [];
  for (const pin of listLibraryPins(userId)) {
    const parsed = parseLibraryAlbumPinKey(pin.itemKey);
    if (parsed) wanted.push(parsed);
  }
  const albums = wanted.length;

  const trackIds = new Set<string>();
  const likedIds = getDb()
    .prepare(`SELECT track_id as id FROM track_likes WHERE user_id = ?`)
    .all(userId) as { id: string }[];
  for (const row of likedIds) {
    if (row.id) trackIds.add(row.id);
  }

  if (wanted.length > 0) {
    const clause = wanted
      .map(() => `(lower(artist) = ? AND lower(album) = ?)`)
      .join(" OR ");
    const albumTracks = getDb()
      .prepare(
        `SELECT id FROM tracks
         WHERE album IS NOT NULL AND trim(album) != ''
           AND ${LIBRARY_TRACK_FILTER}
           AND (${clause})`,
      )
      .all(...wanted.flatMap((w) => [w.artist, w.album])) as { id: string }[];
    for (const row of albumTracks) {
      if (row.id) trackIds.add(row.id);
    }
  }

  return { albums, tracks: trackIds.size };
}

/**
 * Sidebar albums the user explicitly saved/pinned — not the full scanned catalog.
 * Same item shape as listLibraryNavItems (title/artist/tracks/cover via the same GROUP BY).
 */
export function listPinnedAlbumNavItems(userId: string): {
  type: "album" | "playlist";
  key: string;
  title: string;
  artist: string;
  tracks: number;
  image: string | null;
}[] {
  const wanted: { artist: string; album: string }[] = [];
  for (const pin of listLibraryPins(userId)) {
    const parsed = parseLibraryAlbumPinKey(pin.itemKey);
    if (parsed) wanted.push(parsed);
  }
  if (!wanted.length) return [];

  const clause = wanted
    .map(() => `(lower(artist) = ? AND lower(album) = ?)`)
    .join(" OR ");
  const albums = getDb()
    .prepare(
      `SELECT album as title,
              artist as artist,
              COUNT(*) as tracks,
              MAX(mtime_ms) as mtime,
              MAX(CASE
                WHEN cover_path IS NOT NULL AND trim(cover_path) != ''
                THEN cover_path END) as image
       FROM tracks
       WHERE album IS NOT NULL AND trim(album) != ''
         AND ${LIBRARY_TRACK_FILTER}
         AND (${clause})
       GROUP BY lower(artist), lower(album)`,
    )
    .all(...wanted.flatMap((w) => [w.artist, w.album])) as {
    title: string;
    artist: string;
    tracks: number;
    mtime: number;
    image: string | null;
  }[];

  const byPinKey = new Map(
    albums.map((a) => [
      libraryAlbumPinKey(a.artist, a.title),
      {
        type: "album" as const,
        key: `${a.artist}::${a.title}`.toLowerCase(),
        title: a.title,
        artist: a.artist || "Unknown artist",
        tracks: a.tracks,
        image: a.image || null,
      },
    ]),
  );

  const items: {
    type: "album" | "playlist";
    key: string;
    title: string;
    artist: string;
    tracks: number;
    image: string | null;
  }[] = [];
  const seen = new Set<string>();
  for (const w of wanted) {
    const item = byPinKey.get(libraryAlbumPinKey(w.artist, w.album));
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    items.push(item);
  }
  return items;
}

export const LIBRARY_LIKED_PIN_KEY = "liked";

export function listLibraryPins(userId: string): {
  itemKey: string;
  pinnedAt: string;
}[] {
  if (!userId) return [];
  return getDb()
    .prepare(
      `SELECT item_key as itemKey, pinned_at as pinnedAt
       FROM library_pins WHERE user_id = ?
       ORDER BY pinned_at DESC`,
    )
    .all(userId) as { itemKey: string; pinnedAt: string }[];
}

export function isLibraryPinned(userId: string, itemKey: string): boolean {
  if (!userId || !itemKey) return false;
  const row = getDb()
    .prepare(
      `SELECT 1 as ok FROM library_pins WHERE user_id = ? AND item_key = ?`,
    )
    .get(userId, itemKey) as { ok: number } | undefined;
  return Boolean(row);
}

export function setLibraryPin(userId: string, itemKey: string): void {
  const key = itemKey.trim().slice(0, 400);
  if (!userId || !key) return;
  getDb()
    .prepare(
      `INSERT INTO library_pins(user_id, item_key, pinned_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, item_key) DO UPDATE SET pinned_at = excluded.pinned_at`,
    )
    .run(userId, key, nowIso());
}

export function clearLibraryPin(userId: string, itemKey: string): void {
  const key = itemKey.trim();
  if (!userId || !key) return;
  getDb()
    .prepare(`DELETE FROM library_pins WHERE user_id = ? AND item_key = ?`)
    .run(userId, key);
}

/** Stamp cover URL onto local tracks for an album (sidebar / player reuse). */
export function setAlbumCover(
  artist: string,
  album: string,
  imageUrl: string,
): void {
  const a = artist.trim().toLowerCase();
  const al = album.trim().toLowerCase();
  const url = imageUrl.trim();
  if (!a || !al || !url || !/^https?:\/\//i.test(url)) return;
  getDb()
    .prepare(
      `UPDATE tracks
       SET cover_path = ?
       WHERE lower(artist) = ? AND lower(album) = ?
         AND (cover_path IS NULL OR trim(cover_path) = ''
              OR cover_path NOT LIKE 'http%')`,
    )
    .run(url, a, al);
}

/** Top albums from the shared library for public profiles. */
export function publicAlbumsFromLibrary(limit = 16): {
  title: string;
  artist: string;
  tracks: number;
}[] {
  return getDb()
    .prepare(
      `SELECT album as title,
              artist as artist,
              COUNT(*) as tracks
       FROM tracks
       WHERE album IS NOT NULL AND trim(album) != ''
         AND ${LIBRARY_TRACK_FILTER}
       GROUP BY lower(artist), lower(album)
       ORDER BY tracks DESC, title ASC
       LIMIT ?`,
    )
    .all(limit) as {
    title: string;
    artist: string;
    tracks: number;
  }[];
}

export function libraryStats(): {
  tracks: number;
  albums: number;
  artists: number;
} {
  const tracks = countTracks();
  const albums = (
    getDb()
      .prepare(
        `SELECT COUNT(*) as c FROM (
           SELECT 1 FROM tracks
           WHERE ${LIBRARY_TRACK_FILTER}
           GROUP BY lower(artist), lower(album)
         )`,
      )
      .get() as { c: number }
  ).c;
  const artists = (
    getDb()
      .prepare(
        `SELECT COUNT(*) as c FROM (
           SELECT 1 FROM tracks
           WHERE artist IS NOT NULL AND trim(artist) != ''
             AND ${LIBRARY_TRACK_FILTER}
           GROUP BY lower(artist)
         )`,
      )
      .get() as { c: number }
  ).c;
  return { tracks, albums, artists };
}

// ─── Tracks (library) ───────────────────────────────────────────────────────

function asTrackSource(raw: unknown): TrackRow["source"] {
  const s = String(raw || "");
  if (s === "slskd") return "fallback";
  if (s === "library" || s === "lidarr" || s === "fallback" || s === "stream") {
    return s;
  }
  return "library";
}

function mapTrack(row: Record<string, unknown>): TrackRow {
  return {
    id: String(row.id),
    title: String(row.title),
    artist: String(row.artist),
    album: String(row.album),
    duration: Number(row.duration) || 0,
    path: String(row.path),
    coverPath: (row.coverPath as string | null) ?? null,
    source: asTrackSource(row.source),
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

function findTrackExact(artist: string, title: string): TrackRow | null {
  const a = artist.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  if (!a || !t) return null;
  const row = getDb()
    .prepare(
      `${TRACK_SELECT}
       WHERE lower(artist) = ? AND lower(title) = ?
         AND source != 'stream'
         AND path NOT LIKE 'stream:%'
         AND path NOT LIKE 'stream://%'
       ORDER BY CASE source
         WHEN 'lidarr' THEN 0
         WHEN 'library' THEN 0
         WHEN 'fallback' THEN 2
         WHEN 'slskd' THEN 2
         ELSE 1
       END
       LIMIT 1`,
    )
    .get(a, t) as Record<string, unknown> | undefined;
  return row ? mapTrack(row) : null;
}

function findTrackByMatchKey(key: string): TrackRow | null {
  if (!key) return null;
  const row = getDb()
    .prepare(
      `${TRACK_SELECT}
       WHERE match_key = ?
         AND source != 'stream'
         AND path NOT LIKE 'stream:%'
         AND path NOT LIKE 'stream://%'
       ORDER BY CASE source
         WHEN 'lidarr' THEN 0
         WHEN 'library' THEN 0
         WHEN 'fallback' THEN 2
         WHEN 'slskd' THEN 2
         ELSE 1
       END
       LIMIT 1`,
    )
    .get(key) as Record<string, unknown> | undefined;
  return row ? mapTrack(row) : null;
}

/**
 * Prefer local library files.
 * 1) exact artist+title
 * 2) indexed match_key (from scan / tag read)
 * 3) soft candidate score (last resort)
 *
 * Never attach another artist’s file, or a different title via prefix
 * (“Love” must not become “Love Story”).
 */
function libraryHitAgrees(hit: TrackRow, artist: string, title: string): boolean {
  return namesMatch(hit.artist, artist) && titlesMatch(hit.title, title);
}

/**
 * Hot-path lookup: exact + match_key only (no LIKE fuzzy scan).
 * Use for live resolve and album availability under concurrent load.
 */
export function findTrackFast(artist: string, title: string): TrackRow | null {
  const rawArtist = artist.trim();
  const rawTitle = title.trim();
  if (!rawArtist || !rawTitle) return null;

  const exact = findTrackExact(rawArtist, rawTitle);
  if (exact && libraryHitAgrees(exact, rawArtist, rawTitle)) return exact;

  const primary = primaryArtistName(rawArtist);
  if (primary && primary.toLowerCase() !== rawArtist.toLowerCase()) {
    const byPrimary = findTrackExact(primary, rawTitle);
    if (byPrimary && libraryHitAgrees(byPrimary, primary, rawTitle)) {
      return byPrimary;
    }
  }

  const indexed =
    findTrackByMatchKey(trackMatchKey(rawArtist, rawTitle)) ||
    (primary ? findTrackByMatchKey(trackMatchKey(primary, rawTitle)) : null);
  if (indexed && libraryHitAgrees(indexed, rawArtist, rawTitle)) return indexed;
  // Also accept when credit was primary-only vs feat. in DB
  if (
    indexed &&
    primary &&
    libraryHitAgrees(indexed, primary, rawTitle)
  ) {
    return indexed;
  }
  return null;
}

export function findTrack(artist: string, title: string): TrackRow | null {
  const rawArtist = artist.trim();
  const rawTitle = title.trim();
  if (!rawArtist || !rawTitle) return null;

  const fast = findTrackFast(rawArtist, rawTitle);
  if (fast) return fast;

  const primary = primaryArtistName(rawArtist);
  const candidates = new Map<string, TrackRow>();
  for (const q of matchSearchQueries(rawArtist, rawTitle)) {
    for (const hit of searchTracksLocal(q, 40)) {
      candidates.set(hit.id, hit);
    }
  }

  let best: TrackRow | null = null;
  let bestScore = 0;
  for (const hit of candidates.values()) {
    if (!libraryHitAgrees(hit, rawArtist, rawTitle)) continue;
    const score = Math.max(
      scoreTrackMatch(hit, rawArtist, rawTitle),
      primary ? scoreTrackMatch(hit, primary, rawTitle) : 0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = hit;
    }
  }
  return best && bestScore >= TRACK_MATCH_MIN_SCORE ? best : null;
}

export function listTracks(limit = 200, offset = 0): TrackRow[] {
  return (
    getDb()
      .prepare(
        `${TRACK_SELECT}
         WHERE ${LIBRARY_TRACK_FILTER}
         ORDER BY added_at DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Record<string, unknown>[]
  ).map(mapTrack);
}

export function countTracks(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM tracks WHERE ${LIBRARY_TRACK_FILTER}`,
    )
    .get() as { c: number };
  return row.c;
}

export type AlbumListRow = {
  artist: string;
  title: string;
  trackCount: number;
  coverPath: string | null;
  addedAt: string;
};

/** Distinct albums from library tracks, newest activity first. */
export function listAlbumsPaginated(
  limit = 10,
  offset = 0,
): AlbumListRow[] {
  return getDb()
    .prepare(
      `SELECT
         artist as artist,
         album as title,
         COUNT(*) as trackCount,
         MAX(cover_path) as coverPath,
         MAX(added_at) as addedAt
       FROM tracks
       WHERE ${LIBRARY_TRACK_FILTER}
         AND album IS NOT NULL AND trim(album) != ''
       GROUP BY lower(artist), lower(album)
       ORDER BY MAX(added_at) DESC, album ASC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as AlbumListRow[];
}

export function countAlbums(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM (
         SELECT 1 FROM tracks
         WHERE ${LIBRARY_TRACK_FILTER}
           AND album IS NOT NULL AND trim(album) != ''
         GROUP BY lower(artist), lower(album)
       )`,
    )
    .get() as { c: number };
  return row.c;
}

const SEARCH_STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "ft",
  "feat",
  "featuring",
]);

function queryLibraryByTokens(
  tokens: string[],
  limit: number,
): Record<string, unknown>[] {
  if (tokens.length === 0) return [];
  const clauses: string[] = [];
  const params: string[] = [];
  for (const raw of tokens) {
    const clean = raw.replace(/[%_]/g, "");
    if (clean.length < 2) continue;
    const stripped = clean.replace(/'/g, "");
    const variants =
      stripped && stripped !== clean ? [clean, stripped] : [clean];
    const parts: string[] = [];
    for (const v of variants) {
      const like = `%${v}%`;
      parts.push(
        `title LIKE ? OR artist LIKE ? OR album LIKE ? OR ifnull(match_key,'') LIKE ?`,
      );
      params.push(like, like, like, like);
    }
    if (parts.length) clauses.push(`(${parts.join(" OR ")})`);
  }
  if (!clauses.length) return [];
  return getDb()
    .prepare(
      `${TRACK_SELECT}
       WHERE (${LIBRARY_TRACK_FILTER})
         AND ${clauses.join(" AND ")}
       LIMIT ?`,
    )
    .all(...params, limit) as Record<string, unknown>[];
}

function scoreLocalSearchHit(query: string, t: TrackRow): number {
  return scoreSearchHit(query, {
    title: t.title,
    artist: t.artist,
    album: t.album,
  });
}

/**
 * Library files matching a free-text query. Token AND across title/artist/album
 * + match_key, ranked by the same scorer as catalog search.
 */
export function searchTracksLocal(q: string, limit = 50): TrackRow[] {
  const term = q.trim().replace(/\s+/g, " ");
  if (!term) return [];
  const tokens = tokenizeSearchQuery(term);
  if (tokens.length === 0) return [];

  const fetchN = Math.min(Math.max(limit * 8, 80), 400);
  let rows = queryLibraryByTokens(tokens, fetchN);
  if (rows.length === 0 && tokens.length > 1) {
    const core = tokens.filter((t) => t.length >= 3 && !SEARCH_STOP.has(t));
    if (core.length > 0 && core.length < tokens.length) {
      rows = queryLibraryByTokens(core, fetchN);
    }
  }

  return rows
    .map(mapTrack)
    .sort((a, b) => scoreLocalSearchHit(term, b) - scoreLocalSearchHit(term, a))
    .slice(0, limit);
}

/** Library tracks whose cached lyrics contain the query (phrase or tokens). */
export function searchTracksByLyrics(q: string, limit = 24): TrackRow[] {
  const term = q.trim().replace(/\s+/g, " ");
  if (term.length < 4) return [];

  const seen = new Set<string>();
  const out: TrackRow[] = [];

  function pushTrack(track: TrackRow | null) {
    if (!track || seen.has(track.id)) return;
    seen.add(track.id);
    out.push(track);
  }

  const phraseLike = `%${term.toLowerCase()}%`;
  const phraseRows = getDb()
    .prepare(
      `SELECT artist, title
       FROM lyrics_cache
       WHERE lower(lines_json) LIKE ?
          OR lower(coalesce(genius_json, '')) LIKE ?
       LIMIT ?`,
    )
    .all(phraseLike, phraseLike, Math.min(limit * 4, 96)) as {
    artist: string;
    title: string;
  }[];

  for (const row of phraseRows) {
    pushTrack(findTrack(row.artist, row.title));
    if (out.length >= limit) return out;
  }

  const tokens = tokenizeSearchQuery(term).filter(
    (t) => t.length >= 4 && !SEARCH_STOP.has(t),
  );
  for (const token of tokens.slice(0, 4)) {
    const like = `%${token.toLowerCase()}%`;
    const rows = getDb()
      .prepare(
        `SELECT artist, title
         FROM lyrics_cache
         WHERE lower(lines_json) LIKE ?
            OR lower(coalesce(genius_json, '')) LIKE ?
         LIMIT ?`,
      )
      .all(like, like, 32) as { artist: string; title: string }[];
    for (const row of rows) {
      pushTrack(findTrack(row.artist, row.title));
      if (out.length >= limit) return out;
    }
  }

  return out;
}

export function getTrack(id: string): TrackRow | null {
  const row = getDb()
    .prepare(`${TRACK_SELECT} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapTrack(row) : null;
}

/**
 * Remove a track from the library index (and related history/offline).
 * Pass `{ deleteFiles: true }` only from Admin/Owner APIs — that unlinks the
 * audio file when it lives under a managed music root.
 */
export function deleteTrack(
  id: string,
  options?: { deleteFiles?: boolean },
): TrackRow | null {
  const track = getTrack(id);
  if (!track) return null;
  const db = getDb();
  // Keep likes as stream-only entries so hearts survive library removal
  const likeRows = db
    .prepare(
      `SELECT user_id as userId, liked_at as likedAt FROM track_likes WHERE track_id = ?`,
    )
    .all(id) as { userId: string; likedAt: string }[];
  const streamId = streamLikeId(track.artist, track.title);
  for (const row of likeRows) {
    db.prepare(`DELETE FROM track_likes WHERE user_id = ? AND track_id = ?`).run(
      row.userId,
      id,
    );
    db.prepare(
      `INSERT INTO track_likes(
         user_id, track_id, liked_at, title, artist, album, cover_path, duration
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, track_id) DO UPDATE SET
         liked_at = excluded.liked_at,
         title = excluded.title,
         artist = excluded.artist,
         album = excluded.album,
         cover_path = excluded.cover_path,
         duration = excluded.duration`,
    ).run(
      row.userId,
      streamId,
      row.likedAt,
      track.title,
      track.artist,
      track.album,
      track.coverPath,
      track.duration,
    );
  }
  db.prepare(`DELETE FROM play_history WHERE track_id = ?`).run(id);
  db.prepare(`DELETE FROM offline_marks WHERE track_id = ?`).run(id);
  db.prepare(`DELETE FROM playlist_tracks WHERE track_id = ?`).run(id);
  db.prepare(`DELETE FROM tracks WHERE id = ?`).run(id);

  if (options?.deleteFiles) {
    const settings = getSettings();
    unlinkManagedAudioFile(track.path, [settings.musicRoot].filter(Boolean));
  }

  return track;
}

/** Remove all indexed tracks for an album (artist + album title). */
export function deleteAlbumTracks(
  artist: string,
  album: string,
  options?: { deleteFiles?: boolean },
): number {
  const rows = listTracksForAlbum(artist, album, 500);
  for (const t of rows) deleteTrack(t.id, options);
  return rows.length;
}

export function hasLibraryMatch(artist: string, albumOrTitle: string): boolean {
  const a = artist.trim().toLowerCase();
  const t = albumOrTitle.trim().toLowerCase();
  // Must match findTrack filters — stream/live rows must not look like library.
  const row = getDb()
    .prepare(
      `SELECT 1 as ok FROM tracks
       WHERE lower(artist) = ? AND (lower(album) = ? OR lower(title) = ?)
         AND ${LIBRARY_TRACK_FILTER}
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
  // Never persist album-art filenames as playable tracks.
  if (isArtworkAudioPath(track.path)) return;

  let title = cleanAudioTag(track.title) || track.title.trim();
  if (isArtworkFilename(title)) {
    title = titleFromAudioPath(track.path);
  }
  if (!title || isArtworkFilename(title)) return;

  const artist =
    cleanAudioTag(track.artist) || track.artist.trim() || "Unknown Artist";
  const album = cleanAudioTag(track.album) || track.album.trim() || "";

  const ts = nowIso();
  const matchKey = trackMatchKey(artist, title);
  getDb()
    .prepare(
      `INSERT INTO tracks(
         id, title, artist, album, duration, path, cover_path, source,
         external_id, file_size, mtime_ms, match_key, added_at, updated_at
       ) VALUES (
         @id, @title, @artist, @album, @duration, @path, @coverPath, @source,
         @externalId, @fileSize, @mtimeMs, @matchKey, @addedAt, @updatedAt
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
         match_key=excluded.match_key,
         updated_at=excluded.updated_at`,
    )
    .run({
      id: track.id,
      title,
      artist,
      album,
      duration: track.duration,
      path: track.path,
      coverPath: track.coverPath,
      source: track.source,
      externalId: track.externalId,
      fileSize: track.fileSize ?? 0,
      mtimeMs: track.mtimeMs ?? 0,
      matchKey,
      addedAt: track.addedAt || ts,
      updatedAt: track.updatedAt || ts,
    });

  // Library import may satisfy open requests
  markMatchingRequestsAvailable(artist, album, title);
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
    source: String(row.source) === "lidarr" ? "lidarr" : "fallback",
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

/** Most recent request for a key (any status) — used to avoid activity spam. */
export function findLatestRequest(normalizedKey: string): RequestRow | null {
  const row = getDb()
    .prepare(
      `${REQUEST_SELECT}
       WHERE normalized_key = ?
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
  imageUrl?: string | null;
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
    // Reuse an earlier "available" row — re-POST poll must not spam Requests.
    const latest = findLatestRequest(key);
    if (latest?.status === "available") {
      return latest;
    }
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
    // Already in library — no toast spam
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
  // Admin-only for new album/artist library requests — skip track acquire spam
  if (row.status !== "available" && row.mediaType !== "track") {
    notifyFromRequest(row, "new", input.imageUrl);
  }
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
  const updated = getRequest(id);
  if (updated && current.status !== status) {
    if (status === "failed") {
      notifyFromRequest(updated, "failed");
    } else if (status === "downloading") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { notifyDiscord } =
          require("./admin-notify") as typeof import("./admin-notify");
        notifyDiscord("downloadStarted", {
          title: "Download started",
          description: `${updated.title} — ${updated.artist}`,
          href: "/admin/requests",
          fields: [
            { name: "Source", value: updated.source, inline: true },
            { name: "By", value: updated.requestedBy || "—", inline: true },
          ],
        });
      } catch {
        /* ignore */
      }
    } else if (
      status === "available" &&
      (current.status === "downloading" ||
        current.status === "queued" ||
        current.status === "pending")
    ) {
      // Only when something actually finished acquiring — not instant library
      notifyFromRequest(updated, "available");
    }
  }
  return updated;
}

// ─── In-app notifications ───────────────────────────────────────────────────

export type AppNotification = {
  id: string;
  userId: string;
  kind: string;
  actorLabel: string;
  message: string;
  href: string | null;
  imageSeed: string | null;
  imageUrl: string | null;
  mediaType: string | null;
  requestId: string | null;
  createdAt: string;
  readAt: string | null;
  unread: boolean;
};

function listAdminUserIds(): string[] {
  return (
    getDb()
      .prepare(`SELECT id FROM users WHERE is_admin = 1`)
      .all() as { id: string }[]
  ).map((r) => r.id);
}

function getUserIdByUsername(username: string | null | undefined): string | null {
  if (!username?.trim()) return null;
  const row = getDb()
    .prepare(`SELECT id FROM users WHERE lower(username) = lower(?) LIMIT 1`)
    .get(username.trim()) as { id: string } | undefined;
  return row?.id ?? null;
}

function pushNotification(input: {
  userId: string;
  kind: string;
  actorLabel: string;
  message: string;
  href?: string | null;
  imageSeed?: string | null;
  imageUrl?: string | null;
  mediaType?: string | null;
  requestId?: string | null;
  dedupeKey?: string | null;
}) {
  if (!input.userId) return;
  // Collapse lifecycle for a request into one row
  if (input.requestId) {
    getDb()
      .prepare(
        `DELETE FROM notifications
         WHERE user_id = ? AND request_id = ?`,
      )
      .run(input.userId, input.requestId);
  }
  const dedupe = input.dedupeKey || null;
  if (dedupe) {
    const existing = getDb()
      .prepare(
        `SELECT id, read_at as readAt FROM notifications
         WHERE user_id = ? AND dedupe_key = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(input.userId, dedupe) as
      | { id: string; readAt: string | null }
      | undefined;
    if (existing && !existing.readAt) {
      getDb()
        .prepare(
          `UPDATE notifications SET
             kind = ?, actor_label = ?, message = ?, href = ?, image_seed = ?,
             image_url = ?, media_type = ?, created_at = ?, request_id = ?
           WHERE id = ?`,
        )
        .run(
          input.kind,
          input.actorLabel,
          input.message,
          input.href ?? null,
          input.imageSeed ?? null,
          input.imageUrl ?? null,
          input.mediaType ?? null,
          nowIso(),
          input.requestId ?? null,
          existing.id,
        );
      return;
    }
  }
  getDb()
    .prepare(
      `INSERT INTO notifications(
         id, user_id, kind, actor_label, message, href, image_seed,
         image_url, media_type, request_id, dedupe_key, created_at, read_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      newId(),
      input.userId,
      input.kind,
      input.actorLabel,
      input.message,
      input.href ?? null,
      input.imageSeed ?? null,
      input.imageUrl ?? null,
      input.mediaType ?? null,
      input.requestId ?? null,
      dedupe,
      nowIso(),
    );
  // Cap history
  getDb()
    .prepare(
      `DELETE FROM notifications
       WHERE user_id = ?
         AND id IN (
           SELECT id FROM (
             SELECT id FROM notifications
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT -1 OFFSET 80
           )
         )`,
    )
    .run(input.userId, input.userId);
}

function notifyFromRequest(
  req: RequestRow,
  event: "new" | "available" | "failed",
  imageUrl?: string | null,
) {
  const seed = `${req.artist}-${req.title}`;
  const media = req.mediaType === "track" ? "track" : req.mediaType;
  const requesterId = getUserIdByUsername(req.requestedBy);

  const adminIds = listAdminUserIds();
  const targets = new Set<string>();

  if (event === "new") {
    for (const id of adminIds) targets.add(id);
  } else if (event === "failed") {
    for (const id of adminIds) targets.add(id);
    if (requesterId) targets.add(requesterId);
  } else if (event === "available") {
    if (requesterId) targets.add(requesterId);
  }

  if (targets.size === 0) return;

  let actorLabel = "Polarr";
  let message = "";
  let href = "/admin/requests";
  let kind = `request_${event}`;

  if (event === "new") {
    actorLabel = req.requestedBy || "Someone";
    if (media === "artist") {
      message = `requested artist ${req.artist || req.title}`;
      href = `/artist?name=${encodeURIComponent(req.artist || req.title)}`;
      if (req.foreignArtistId) {
        href += `&foreignArtistId=${encodeURIComponent(req.foreignArtistId)}`;
      }
    } else if (media === "album") {
      message = `requested album ${req.title} by ${req.artist}`;
    } else {
      message = `requested track ${req.title} by ${req.artist}`;
    }
    kind = "request_new";
  } else if (event === "available") {
    actorLabel = req.artist || "Library";
    message =
      media === "artist"
        ? `${req.artist || req.title} is ready`
        : `${req.title} is ready to play`;
    href = `/library?album=${encodeURIComponent(req.album)}&artist=${encodeURIComponent(req.artist)}`;
    kind = "request_available";
  } else {
    actorLabel = req.artist || "Download";
    message = `failed to get ${req.title}${req.error ? `: ${req.error}` : ""}`;
    kind = "request_failed";
  }

  for (const userId of targets) {
    pushNotification({
      userId,
      kind,
      actorLabel,
      message: message.slice(0, 280),
      href,
      imageSeed: seed,
      imageUrl: imageUrl ?? null,
      mediaType: req.mediaType,
      requestId: req.id,
      // One lifecycle row per request
      dedupeKey: `request:${req.id}`,
    });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { notifyDiscord } = require("./admin-notify") as typeof import("./admin-notify");
    if (event === "new") {
      notifyDiscord("requestNew", {
        title: "New request",
        description: `${actorLabel} ${message}`,
        href,
        fields: [
          { name: "Type", value: media, inline: true },
          { name: "Title", value: req.title || "—", inline: true },
          { name: "Artist", value: req.artist || "—", inline: true },
        ],
      });
    } else if (event === "available") {
      notifyDiscord("requestAvailable", {
        title: "Ready to stream",
        description: message,
        href,
      });
    } else {
      notifyDiscord("requestFailed", {
        title: "Download failed",
        description: message,
        href,
      });
    }
  } catch {
    /* ignore */
  }
}

export function listNotifications(
  userId: string,
  limit = 40,
): AppNotification[] {
  if (!userId) return [];
  const rows = getDb()
    .prepare(
      `SELECT id, user_id as userId, kind, actor_label as actorLabel,
              message, href, image_seed as imageSeed, image_url as imageUrl,
              media_type as mediaType, request_id as requestId,
              created_at as createdAt, read_at as readAt
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(userId, limit) as {
    id: string;
    userId: string;
    kind: string;
    actorLabel: string;
    message: string;
    href: string | null;
    imageSeed: string | null;
    imageUrl: string | null;
    mediaType: string | null;
    requestId: string | null;
    createdAt: string;
    readAt: string | null;
  }[];

  return rows.map((r) => ({
    ...r,
    imageUrl: r.imageUrl ?? null,
    mediaType: r.mediaType ?? null,
    unread: !r.readAt,
  }));
}

export function countUnreadNotifications(userId: string): number {
  if (!userId) return 0;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM notifications
       WHERE user_id = ? AND read_at IS NULL`,
    )
    .get(userId) as { c: number };
  return Number(row?.c) || 0;
}

/** Mark all (or specific) notifications as read for a user. */
export function markNotificationsRead(
  userId: string,
  ids?: string[],
): number {
  if (!userId) return 0;
  const at = nowIso();
  if (ids && ids.length > 0) {
    const stmt = getDb().prepare(
      `UPDATE notifications SET read_at = ?
       WHERE user_id = ? AND id = ? AND read_at IS NULL`,
    );
    const tx = getDb().transaction((list: string[]) => {
      let n = 0;
      for (const id of list) {
        const r = stmt.run(at, userId, id);
        n += r.changes;
      }
      return n;
    });
    return tx(ids);
  }
  const r = getDb()
    .prepare(
      `UPDATE notifications SET read_at = ?
       WHERE user_id = ? AND read_at IS NULL`,
    )
    .run(at, userId);
  return r.changes;
}

export function getRequest(id: string): RequestRow | null {
  const row = getDb()
    .prepare(`${REQUEST_SELECT} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapRequest(row) : null;
}

export function listRequests(limit = 100): RequestRow[] {
  // Fetch extras then collapse to one row per title key (latest first).
  const fetchLimit = Math.min(Math.max(limit * 4, limit), 500);
  const rows = (
    getDb()
      .prepare(`${REQUEST_SELECT} ORDER BY created_at DESC LIMIT ?`)
      .all(fetchLimit) as Record<string, unknown>[]
  ).map(mapRequest);

  const seen = new Set<string>();
  const out: RequestRow[] = [];
  for (const r of rows) {
    const key = r.normalizedKey?.trim() || r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
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
    } else if (patch.status === "cancelled") {
      updateRequestStatus(current.requestId, "cancelled", {
        error: null,
        message: patch.error ?? "Stopped by admin",
      });
    } else if (patch.status === "running") {
      updateRequestStatus(current.requestId, "downloading", {
        message: "Fallback download running",
      });
    }
  }
  return next;
}

export function getDownload(id: string): DownloadJob | null {
  const row = getDb()
    .prepare(
      `SELECT id, request_id as requestId, query, title, artist, status, progress,
              error, output_path as outputPath, created_at as createdAt,
              updated_at as updatedAt FROM downloads WHERE id = ?`,
    )
    .get(id) as DownloadJob | undefined;
  return row ?? null;
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

export function markOffline(trackId: string, userId: string, deviceId?: string) {
  getDb()
    .prepare(
      `INSERT INTO offline_marks(id, track_id, user_id, device_id, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(track_id, user_id) DO UPDATE SET device_id=excluded.device_id`,
    )
    .run(newId(8), trackId, userId, deviceId ?? null, nowIso());
}

export function listOfflineTrackIds(userId: string): string[] {
  const rows = getDb()
    .prepare(`SELECT track_id as trackId FROM offline_marks WHERE user_id = ?`)
    .all(userId) as { trackId: string }[];
  return rows.map((r) => r.trackId);
}

// ─── Playlists ──────────────────────────────────────────────────────────────

const PLAYLIST_COVER_EXTS = ["jpg", "jpeg", "png", "webp", "gif"] as const;

const PLAYLIST_SELECT = `SELECT p.id, p.user_id as userId, p.name,
        p.description as description,
        p.created_at as createdAt, p.updated_at as updatedAt,
        p.cover_path as coverPath, p.folder_id as folderId,
        COALESCE(p.is_private, 0) as isPrivate,
        (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) as trackCount
 FROM playlists p`;

export const PLAYLIST_DESCRIPTION_MAX = 1000;

export type PlaylistRow = {
  id: string;
  userId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  trackCount: number;
  coverPath: string | null;
  folderId: string | null;
  coverUrl: string | null;
  isPrivate: boolean;
};

export type PlaylistDetail = PlaylistRow & {
  ownerUsername: string;
  ownerAvatarUrl: string | null;
};

export type PlaylistFolderRow = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  playlistCount: number;
};

export function playlistCoverPublicUrl(
  id: string,
  coverPath: string | null | undefined,
  updatedAt?: string,
): string | null {
  if (!id || !coverPath?.trim()) return null;
  const v = updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : "";
  return `/api/playlists/${encodeURIComponent(id)}/cover${v}`;
}

function mapPlaylistRow(row: Record<string, unknown>): PlaylistRow {
  const id = String(row.id);
  const coverPath = (row.coverPath as string | null) || null;
  const updatedAt = String(row.updatedAt || "");
  return {
    id,
    userId: String(row.userId),
    name: String(row.name),
    description: String(row.description || ""),
    createdAt: String(row.createdAt || ""),
    updatedAt,
    trackCount: Number(row.trackCount) || 0,
    coverPath,
    folderId: (row.folderId as string | null) || null,
    coverUrl: playlistCoverPublicUrl(id, coverPath, updatedAt),
    isPrivate: Number(row.isPrivate) === 1,
  };
}

export function nextPlaylistName(userId: string): string {
  const names = new Set(
    (
      getDb()
        .prepare(`SELECT name FROM playlists WHERE user_id = ?`)
        .all(userId) as { name: string }[]
    ).map((r) => r.name),
  );
  let n = 1;
  while (names.has(`My Playlist #${n}`)) n += 1;
  return `My Playlist #${n}`;
}

export function nextFolderName(userId: string): string {
  const names = new Set(
    (
      getDb()
        .prepare(`SELECT name FROM playlist_folders WHERE user_id = ?`)
        .all(userId) as { name: string }[]
    ).map((r) => r.name),
  );
  if (!names.has("New folder")) return "New folder";
  let n = 2;
  while (names.has(`New folder ${n}`)) n += 1;
  return `New folder ${n}`;
}

export function listUserPlaylists(userId: string): PlaylistRow[] {
  if (!userId) return [];
  return (
    getDb()
      .prepare(
        `${PLAYLIST_SELECT}
         WHERE p.user_id = ?
         ORDER BY p.updated_at DESC`,
      )
      .all(userId) as Record<string, unknown>[]
  ).map(mapPlaylistRow);
}

/** All user-created playlists on the server (admin / staff). */
export function listAllUserPlaylists(): (PlaylistRow & {
  ownerUsername: string;
})[] {
  return (
    getDb()
      .prepare(
        `SELECT p.id, p.user_id as userId, p.name,
                p.description as description,
                p.created_at as createdAt, p.updated_at as updatedAt,
                p.cover_path as coverPath, p.folder_id as folderId,
                (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) as trackCount,
                COALESCE(u.username, 'Unknown') as ownerUsername
         FROM playlists p
         LEFT JOIN users u ON u.id = p.user_id
         ORDER BY p.updated_at DESC`,
      )
      .all() as Record<string, unknown>[]
  ).map((row) => ({
    ...mapPlaylistRow(row),
    ownerUsername: String(row.ownerUsername || "Unknown"),
  }));
}

export function listUserPlaylistsInFolder(
  userId: string,
  folderId: string | null,
): PlaylistRow[] {
  if (!userId) return [];
  if (!folderId) {
    return (
      getDb()
        .prepare(
          `${PLAYLIST_SELECT}
           WHERE p.user_id = ? AND (p.folder_id IS NULL OR trim(p.folder_id) = '')
           ORDER BY p.updated_at DESC`,
        )
        .all(userId) as Record<string, unknown>[]
    ).map(mapPlaylistRow);
  }
  return (
    getDb()
      .prepare(
        `${PLAYLIST_SELECT}
         WHERE p.user_id = ? AND p.folder_id = ?
         ORDER BY p.updated_at DESC`,
      )
      .all(userId, folderId) as Record<string, unknown>[]
  ).map(mapPlaylistRow);
}

/** Accept raw ids, URI-encoded ids, or sidebar keys like `playlist:{id}`. */
export function normalizePlaylistId(raw: string | null | undefined): string {
  let id = String(raw || "").trim();
  if (!id) return "";
  try {
    id = decodeURIComponent(id);
  } catch {
    /* keep */
  }
  if (id.toLowerCase().startsWith("playlist:")) id = id.slice("playlist:".length);
  return id.trim();
}

export function getUserPlaylist(
  userId: string,
  playlistId: string,
): PlaylistDetail | null {
  const id = normalizePlaylistId(playlistId);
  if (!userId || !id) return null;
  const row = getDb()
    .prepare(
      `${PLAYLIST_SELECT}
       WHERE p.id = ? AND p.user_id = ?`,
    )
    .get(id, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const mapped = mapPlaylistRow(row);
  const profile = getPublicProfileById(userId);
  return {
    ...mapped,
    ownerUsername: profile?.username || "You",
    ownerAvatarUrl: profile?.avatarUrl || null,
  };
}

/** Homeserver members can view public playlists; private ones are owner-only. */
export function getPlaylistById(
  playlistId: string,
  viewerUserId?: string | null,
): PlaylistDetail | null {
  const id = normalizePlaylistId(playlistId);
  if (!id) return null;
  const row = getDb()
    .prepare(`${PLAYLIST_SELECT} WHERE p.id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const mapped = mapPlaylistRow(row);
  if (mapped.isPrivate && viewerUserId != null && mapped.userId !== viewerUserId) {
    return null;
  }
  const profile = getPublicProfileById(mapped.userId);
  return {
    ...mapped,
    ownerUsername: profile?.username || "Unknown",
    ownerAvatarUrl: profile?.avatarUrl || null,
  };
}

/**
 * If a playlist still points at a stream stub, retarget it to the on-disk
 * library/Lidarr row when one exists (import → later download).
 */
function resolvePlaylistTrackRow(
  playlistId: string,
  track: TrackRow,
): TrackRow {
  const preferred = preferLibraryTrack(track);
  if (preferred.id === track.id) return preferred;

  try {
    const db = getDb();
    const already = db
      .prepare(
        `SELECT 1 as ok FROM playlist_tracks
         WHERE playlist_id = ? AND track_id = ?`,
      )
      .get(playlistId, preferred.id) as { ok: number } | undefined;
    if (already) {
      db.prepare(
        `DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?`,
      ).run(playlistId, track.id);
    } else {
      db.prepare(
        `UPDATE playlist_tracks SET track_id = ?
         WHERE playlist_id = ? AND track_id = ?`,
      ).run(preferred.id, playlistId, track.id);
    }
  } catch {
    /* best-effort heal */
  }
  return preferred;
}

function mapPlaylistTrackRows(
  playlistId: string,
  rows: Record<string, unknown>[],
): TrackRow[] {
  const out: TrackRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const resolved = resolvePlaylistTrackRow(playlistId, mapTrack(row));
    if (seen.has(resolved.id)) continue;
    seen.add(resolved.id);
    out.push(resolved);
  }
  return out;
}

/** Tracks on a playlist (no ownership check — homeserver read). */
export function listPlaylistTracksById(playlistId: string): TrackRow[] {
  const id = normalizePlaylistId(playlistId);
  if (!id) return [];
  const pl = getDb()
    .prepare(`SELECT id FROM playlists WHERE id = ?`)
    .get(id) as { id: string } | undefined;
  if (!pl) return [];
  const rows = getDb()
    .prepare(
      `SELECT tracks.id, tracks.title, tracks.artist, tracks.album, tracks.duration,
              tracks.path, tracks.cover_path as coverPath, tracks.source,
              tracks.external_id as externalId, tracks.file_size as fileSize,
              tracks.mtime_ms as mtimeMs, pt.added_at as addedAt,
              tracks.updated_at as updatedAt
       FROM playlist_tracks pt
       INNER JOIN tracks ON tracks.id = pt.track_id
       WHERE pt.playlist_id = ?
         AND ${notArtworkTrackSql("tracks.")}
       ORDER BY pt.position ASC`,
    )
    .all(id) as Record<string, unknown>[];
  return mapPlaylistTrackRows(id, rows);
}

export function createPlaylist(userId: string, name?: string | null): PlaylistRow {
  const now = nowIso();
  const id = newId();
  const trimmed = (name || "").trim();
  const finalName = trimmed || nextPlaylistName(userId);
  getDb()
    .prepare(
      `INSERT INTO playlists(id, user_id, name, created_at, updated_at, cover_path, folder_id)
       VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
    )
    .run(id, userId, finalName, now, now);
  return {
    id,
    userId,
    name: finalName,
    description: "",
    createdAt: now,
    updatedAt: now,
    trackCount: 0,
    coverPath: null,
    folderId: null,
    coverUrl: null,
    isPrivate: false,
  };
}

export function updatePlaylistDetails(
  userId: string,
  playlistId: string,
  patch: {
    name?: string;
    description?: string | null;
    isPrivate?: boolean;
  },
): PlaylistRow | null {
  const existing = getUserPlaylist(userId, playlistId);
  if (!existing) return null;

  let nextName = existing.name;
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim().slice(0, 80);
    if (!trimmed) return null;
    nextName = trimmed;
  }

  let nextDescription = existing.description;
  if (patch.description !== undefined) {
    nextDescription = (patch.description || "")
      .trim()
      .slice(0, PLAYLIST_DESCRIPTION_MAX);
  }

  let nextPrivate = existing.isPrivate;
  if (patch.isPrivate !== undefined) {
    nextPrivate = Boolean(patch.isPrivate);
  }

  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE playlists SET name = ?, description = ?, is_private = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      nextName,
      nextDescription,
      nextPrivate ? 1 : 0,
      now,
      existing.id,
      userId,
    );
  return {
    ...existing,
    name: nextName,
    description: nextDescription,
    isPrivate: nextPrivate,
    updatedAt: now,
  };
}

export function renamePlaylist(
  userId: string,
  playlistId: string,
  name: string,
  description?: string | null,
): PlaylistRow | null {
  return updatePlaylistDetails(userId, playlistId, {
    name,
    ...(description !== undefined ? { description } : {}),
  });
}

export function setPlaylistFolder(
  userId: string,
  playlistId: string,
  folderId: string | null,
): PlaylistRow | null {
  const existing = getUserPlaylist(userId, playlistId);
  if (!existing) return null;
  if (folderId) {
    const folder = getPlaylistFolder(userId, folderId);
    if (!folder) return null;
  }
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE playlists SET folder_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    )
    .run(folderId, now, existing.id, userId);
  return { ...existing, folderId, updatedAt: now };
}

export function setPlaylistCoverPath(
  userId: string,
  playlistId: string,
  coverPath: string | null,
): PlaylistRow | null {
  const existing = getUserPlaylist(userId, playlistId);
  if (!existing) return null;
  const now = nowIso();
  const stored = coverPath ? path.basename(coverPath) : null;
  getDb()
    .prepare(
      `UPDATE playlists SET cover_path = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    )
    .run(stored, now, existing.id, userId);
  return {
    ...existing,
    coverPath: stored,
    updatedAt: now,
    coverUrl: playlistCoverPublicUrl(existing.id, stored, now),
  };
}

/** Resolve playlist cover file on disk (portable relative names under playlist-covers). */
export function getPlaylistCoverPath(
  userId: string,
  playlistId: string,
): string | null {
  const id = normalizePlaylistId(playlistId);
  if (!userId || !id) return null;
  const row = getDb()
    .prepare(
      `SELECT cover_path as coverPath FROM playlists WHERE id = ? AND user_id = ?`,
    )
    .get(id, userId) as { coverPath: string | null } | undefined;
  if (!row) return null;

  return resolvePlaylistCoverFile(id, userId, row.coverPath);
}

/** Cover path for any playlist (viewer need not be owner). */
export function getPlaylistCoverPathById(playlistId: string): string | null {
  const id = normalizePlaylistId(playlistId);
  if (!id) return null;
  const row = getDb()
    .prepare(
      `SELECT user_id as userId, cover_path as coverPath FROM playlists WHERE id = ?`,
    )
    .get(id) as { userId: string; coverPath: string | null } | undefined;
  if (!row) return null;
  return resolvePlaylistCoverFile(id, row.userId, row.coverPath);
}

function resolvePlaylistCoverFile(
  id: string,
  userId: string,
  coverPath: string | null | undefined,
): string | null {
  const dir = playlistCoversDir();
  const tries: string[] = [];
  const stored = coverPath?.trim();
  if (stored) {
    tries.push(stored);
    tries.push(path.join(dir, path.basename(stored)));
    if (!path.isAbsolute(stored)) tries.push(path.join(dir, stored));
  }
  for (const ext of PLAYLIST_COVER_EXTS) {
    tries.push(path.join(dir, `${id}.${ext}`));
  }

  const seen = new Set<string>();
  for (const candidate of tries) {
    const abs = path.resolve(candidate);
    if (seen.has(abs)) continue;
    seen.add(abs);
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    const healed = path.basename(abs);
    if (stored !== healed && path.resolve(path.join(dir, healed)) === abs) {
      try {
        getDb()
          .prepare(`UPDATE playlists SET cover_path = ? WHERE id = ? AND user_id = ?`)
          .run(healed, id, userId);
      } catch {
        /* best-effort */
      }
    }
    return abs;
  }
  return null;
}

export function deletePlaylist(
  userId: string,
  playlistId: string,
): { ok: boolean; error?: string } {
  const existing = getUserPlaylist(userId, playlistId);
  if (!existing) return { ok: false, error: "Playlist not found" };
  const cover = getPlaylistCoverPath(userId, existing.id);
  getDb().prepare(`DELETE FROM playlists WHERE id = ? AND user_id = ?`).run(
    existing.id,
    userId,
  );
  if (cover) {
    try {
      fs.unlinkSync(cover);
    } catch {
      /* ignore */
    }
  }
  return { ok: true };
}

/** Staff delete — any user's playlist by id. */
export function adminDeletePlaylist(
  playlistId: string,
): { ok: boolean; error?: string } {
  const existing = getPlaylistById(playlistId);
  if (!existing) return { ok: false, error: "Playlist not found" };
  const cover = getPlaylistCoverPathById(existing.id);
  getDb().prepare(`DELETE FROM playlists WHERE id = ?`).run(existing.id);
  if (cover) {
    try {
      fs.unlinkSync(cover);
    } catch {
      /* ignore */
    }
  }
  return { ok: true };
}

export function addTrackToPlaylist(
  userId: string,
  playlistId: string,
  trackId: string,
): { ok: boolean; error?: string } {
  const id = normalizePlaylistId(playlistId);
  const pl = getDb()
    .prepare(`SELECT id FROM playlists WHERE id = ? AND user_id = ?`)
    .get(id, userId) as { id: string } | undefined;
  if (!pl) return { ok: false, error: "Playlist not found" };
  let track = getTrack(trackId);
  if (!track) return { ok: false, error: "Track not found" };
  // Always store the library file when one exists for this song.
  track = preferLibraryTrack(track);
  const pos = (
    getDb()
      .prepare(
        `SELECT COALESCE(MAX(position), -1) + 1 as n FROM playlist_tracks WHERE playlist_id = ?`,
      )
      .get(id) as { n: number }
  ).n;
  getDb()
    .prepare(
      `INSERT INTO playlist_tracks(playlist_id, track_id, position, added_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(playlist_id, track_id) DO NOTHING`,
    )
    .run(id, track.id, pos, nowIso());
  getDb()
    .prepare(`UPDATE playlists SET updated_at = ? WHERE id = ?`)
    .run(nowIso(), id);
  return { ok: true };
}

export function removeTrackFromPlaylist(
  userId: string,
  playlistId: string,
  trackId: string,
): { ok: boolean; error?: string } {
  const id = normalizePlaylistId(playlistId);
  const pl = getDb()
    .prepare(`SELECT id FROM playlists WHERE id = ? AND user_id = ?`)
    .get(id, userId) as { id: string } | undefined;
  if (!pl) return { ok: false, error: "Playlist not found" };
  const result = getDb()
    .prepare(
      `DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?`,
    )
    .run(id, trackId);
  if (result.changes > 0) {
    getDb()
      .prepare(`UPDATE playlists SET updated_at = ? WHERE id = ?`)
      .run(nowIso(), id);
  }
  return { ok: true };
}

/**
 * Replace playlist membership + order. Track ids not listed are removed.
 * Preserves added_at for tracks that remain. Only existing members are kept
 * (unknown ids ignored).
 */
export function setPlaylistTrackOrder(
  userId: string,
  playlistId: string,
  orderedTrackIds: string[],
): { ok: boolean; error?: string } {
  const id = normalizePlaylistId(playlistId);
  const pl = getDb()
    .prepare(`SELECT id FROM playlists WHERE id = ? AND user_id = ?`)
    .get(id, userId) as { id: string } | undefined;
  if (!pl) return { ok: false, error: "Playlist not found" };

  const existing = getDb()
    .prepare(
      `SELECT track_id as trackId, added_at as addedAt
       FROM playlist_tracks WHERE playlist_id = ?`,
    )
    .all(id) as { trackId: string; addedAt: string }[];
  const addedAt = new Map(existing.map((r) => [r.trackId, r.addedAt]));
  const allowed = new Set(existing.map((r) => r.trackId));
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of orderedTrackIds) {
    const trackId = String(raw || "").trim();
    if (!trackId || !allowed.has(trackId) || seen.has(trackId)) continue;
    seen.add(trackId);
    ordered.push(trackId);
  }

  const stamp = nowIso();
  const tx = getDb().transaction(() => {
    getDb()
      .prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ?`)
      .run(id);
    const insert = getDb().prepare(
      `INSERT INTO playlist_tracks(playlist_id, track_id, position, added_at)
       VALUES (?, ?, ?, ?)`,
    );
    ordered.forEach((trackId, position) => {
      insert.run(id, trackId, position, addedAt.get(trackId) || stamp);
    });
    getDb()
      .prepare(`UPDATE playlists SET updated_at = ? WHERE id = ?`)
      .run(stamp, id);
  });
  tx();
  return { ok: true };
}

/** Playlists for a user, with whether each contains `trackId`. */
export function listUserPlaylistsForTrack(
  userId: string,
  trackId: string,
  meta?: LikeMeta,
): (PlaylistRow & { contains: boolean })[] {
  if (!userId) return [];
  const ids = likeCandidateIds(trackId, meta);
  if (ids.length === 0) {
    return listUserPlaylists(userId).map((p) => ({ ...p, contains: false }));
  }
  const placeholders = ids.map(() => "?").join(", ");
  return (
    getDb()
      .prepare(
        `SELECT p.id, p.user_id as userId, p.name,
                p.description as description,
                p.created_at as createdAt, p.updated_at as updatedAt,
                p.cover_path as coverPath, p.folder_id as folderId,
                (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) as trackCount,
                EXISTS(
                  SELECT 1 FROM playlist_tracks pt
                  WHERE pt.playlist_id = p.id AND pt.track_id IN (${placeholders})
                ) as contains
         FROM playlists p
         WHERE p.user_id = ?
         ORDER BY p.updated_at DESC`,
      )
      .all(...ids, userId) as Record<string, unknown>[]
  ).map((row) => ({
    ...mapPlaylistRow(row),
    contains: Boolean(row.contains),
  }));
}

export function listPlaylistTracks(
  userId: string,
  playlistId: string,
): TrackRow[] {
  const id = normalizePlaylistId(playlistId);
  if (!userId || !id) return [];
  const pl = getDb()
    .prepare(`SELECT id FROM playlists WHERE id = ? AND user_id = ?`)
    .get(id, userId) as { id: string } | undefined;
  if (!pl) return [];
  // playlist_tracks.added_at makes unqualified TRACK_SELECT ambiguous.
  // addedAt is when the track was added to this playlist (pt.added_at).
  const rows = getDb()
    .prepare(
      `SELECT tracks.id, tracks.title, tracks.artist, tracks.album, tracks.duration,
              tracks.path, tracks.cover_path as coverPath, tracks.source,
              tracks.external_id as externalId, tracks.file_size as fileSize,
              tracks.mtime_ms as mtimeMs, pt.added_at as addedAt,
              tracks.updated_at as updatedAt
       FROM playlist_tracks pt
       INNER JOIN tracks ON tracks.id = pt.track_id
       WHERE pt.playlist_id = ?
         AND ${notArtworkTrackSql("tracks.")}
       ORDER BY pt.position ASC`,
    )
    .all(id) as Record<string, unknown>[];
  return mapPlaylistTrackRows(id, rows);
}

export function libraryPlaylistPinKey(playlistId: string): string {
  return `playlist:${playlistId}`;
}

export function libraryFolderPinKey(folderId: string): string {
  return `folder:${folderId}`;
}

function mapFolderRow(row: Record<string, unknown>): PlaylistFolderRow {
  return {
    id: String(row.id),
    userId: String(row.userId),
    name: String(row.name),
    createdAt: String(row.createdAt || ""),
    updatedAt: String(row.updatedAt || ""),
    playlistCount: Number(row.playlistCount) || 0,
  };
}

const FOLDER_SELECT = `SELECT f.id, f.user_id as userId, f.name,
        f.created_at as createdAt, f.updated_at as updatedAt,
        (SELECT COUNT(*) FROM playlists p WHERE p.folder_id = f.id) as playlistCount
 FROM playlist_folders f`;

export function listPlaylistFolders(userId: string): PlaylistFolderRow[] {
  if (!userId) return [];
  return (
    getDb()
      .prepare(
        `${FOLDER_SELECT}
         WHERE f.user_id = ?
         ORDER BY f.updated_at DESC`,
      )
      .all(userId) as Record<string, unknown>[]
  ).map(mapFolderRow);
}

export function getPlaylistFolder(
  userId: string,
  folderId: string,
): PlaylistFolderRow | null {
  if (!userId || !folderId) return null;
  const row = getDb()
    .prepare(
      `${FOLDER_SELECT}
       WHERE f.id = ? AND f.user_id = ?`,
    )
    .get(folderId, userId) as Record<string, unknown> | undefined;
  return row ? mapFolderRow(row) : null;
}

export function createPlaylistFolder(
  userId: string,
  name?: string | null,
): PlaylistFolderRow {
  const now = nowIso();
  const id = newId();
  const trimmed = (name || "").trim();
  const finalName = trimmed || nextFolderName(userId);
  getDb()
    .prepare(
      `INSERT INTO playlist_folders(id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, userId, finalName, now, now);
  return {
    id,
    userId,
    name: finalName,
    createdAt: now,
    updatedAt: now,
    playlistCount: 0,
  };
}

export function renamePlaylistFolder(
  userId: string,
  folderId: string,
  name: string,
): PlaylistFolderRow | null {
  const next = name.trim().slice(0, 80);
  if (!next) return null;
  const existing = getPlaylistFolder(userId, folderId);
  if (!existing) return null;
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE playlist_folders SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    )
    .run(next, now, folderId, userId);
  return { ...existing, name: next, updatedAt: now };
}

export function deletePlaylistFolder(
  userId: string,
  folderId: string,
): { ok: boolean; error?: string } {
  const existing = getPlaylistFolder(userId, folderId);
  if (!existing) return { ok: false, error: "Folder not found" };
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE playlists SET folder_id = NULL, updated_at = ? WHERE folder_id = ? AND user_id = ?`,
    )
    .run(now, folderId, userId);
  getDb()
    .prepare(`DELETE FROM playlist_folders WHERE id = ? AND user_id = ?`)
    .run(folderId, userId);
  return { ok: true };
}

// ─── Taste excludes ─────────────────────────────────────────────────────────

export function excludeTrackFromTaste(userId: string, trackId: string) {
  if (!userId || !trackId || !getTrack(trackId)) return false;
  getDb()
    .prepare(
      `INSERT INTO taste_excludes(user_id, track_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, track_id) DO NOTHING`,
    )
    .run(userId, trackId, nowIso());
  return true;
}

export function listTasteExcludeIds(userId: string): string[] {
  if (!userId) return [];
  return (
    getDb()
      .prepare(`SELECT track_id as id FROM taste_excludes WHERE user_id = ?`)
      .all(userId) as { id: string }[]
  ).map((r) => r.id);
}

export function isTrackTasteExcluded(userId: string, trackId: string): boolean {
  if (!userId || !trackId) return false;
  const row = getDb()
    .prepare(
      `SELECT 1 as ok FROM taste_excludes WHERE user_id = ? AND track_id = ?`,
    )
    .get(userId, trackId) as { ok: number } | undefined;
  return Boolean(row);
}

export function listTracksByArtist(artist: string, limit = 100): TrackRow[] {
  const a = artist.trim().toLowerCase();
  if (!a) return [];
  return (
    getDb()
      .prepare(
        `${TRACK_SELECT}
         WHERE lower(artist) = ?
           AND ${LIBRARY_TRACK_FILTER}
         ORDER BY album ASC, title ASC
         LIMIT ?`,
      )
      .all(a, limit) as Record<string, unknown>[]
  ).map(mapTrack);
}

/** Tracks matching artist + album title (case-insensitive). */
export function listTracksForAlbum(
  artist: string,
  album: string,
  limit = 200,
): TrackRow[] {
  const a = artist.trim().toLowerCase();
  const al = album.trim().toLowerCase();
  if (!a || !al) return [];
  return (
    getDb()
      .prepare(
        `${TRACK_SELECT}
         WHERE lower(artist) = ? AND lower(album) = ?
           AND ${LIBRARY_TRACK_FILTER}
         ORDER BY title ASC
         LIMIT ?`,
      )
      .all(a, al, limit) as Record<string, unknown>[]
  ).map(mapTrack);
}

/**
 * Same as listTracksForAlbum but also includes stream/history stubs.
 * Used when catalog tracklists are missing so album pages aren't empty
 * after someone listened via live stream.
 */
export function listTracksForAlbumIncludingStream(
  artist: string,
  album: string,
  limit = 200,
): TrackRow[] {
  const a = artist.trim().toLowerCase();
  const al = album.trim().toLowerCase();
  if (!a || !al) return [];
  return (
    getDb()
      .prepare(
        `${TRACK_SELECT}
         WHERE lower(artist) = ? AND lower(album) = ?
           AND ${NON_ARTWORK_TRACK_FILTER}
         ORDER BY
           CASE WHEN source = 'stream' OR path LIKE 'stream:%' OR path LIKE 'stream://%'
             THEN 1 ELSE 0 END,
           title ASC
         LIMIT ?`,
      )
      .all(a, al, limit) as Record<string, unknown>[]
  ).map(mapTrack);
}

/** Per-user activity for admin user detail (requests.requested_by is username). */
export function getUserActivityStats(userId: string) {
  const user = getPublicProfileById(userId);
  if (!user) return null;

  const username = user.username;
  const requestRows = getDb()
    .prepare(
      `SELECT status, COUNT(*) as c FROM requests
       WHERE lower(requested_by) = lower(?)
       GROUP BY status`,
    )
    .all(username) as { status: string; c: number }[];

  const requestsByStatus: Record<string, number> = {};
  let requestsTotal = 0;
  for (const r of requestRows) {
    requestsByStatus[r.status] = r.c;
    requestsTotal += r.c;
  }

  const downloadRow = getDb()
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN d.status = 'completed' THEN 1 ELSE 0 END) as completed,
         SUM(CASE WHEN d.status IN ('queued','running') THEN 1 ELSE 0 END) as active
       FROM downloads d
       INNER JOIN requests r ON r.id = d.request_id
       WHERE lower(r.requested_by) = lower(?)`,
    )
    .get(username) as {
    total: number;
    completed: number | null;
    active: number | null;
  };

  const recentRequests = getDb()
    .prepare(
      `SELECT id, media_type as mediaType, title, artist, album, status, source,
              created_at as createdAt
       FROM requests
       WHERE lower(requested_by) = lower(?)
       ORDER BY created_at DESC
       LIMIT 3`,
    )
    .all(username) as {
    id: string;
    mediaType: string;
    title: string;
    artist: string;
    album: string;
    status: string;
    source: string;
    createdAt: string;
  }[];

  // Personal library only (saved albums + liked / album tracks) — never the
  // full shared catalog.
  const personal = userPersonalLibraryStats(userId);

  const listenRow = getDb()
    .prepare(
      `SELECT COALESCE(SUM(seconds), 0) as seconds FROM listen_bucket WHERE user_id = ?`,
    )
    .get(userId) as { seconds: number };
  const listensMinutes = Math.max(
    0,
    Math.round((Number(listenRow?.seconds) || 0) / 60),
  );

  const playRow = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM play_history
       WHERE user_id = ?
         AND (listened_seconds IS NULL OR listened_seconds >= 15)`,
    )
    .get(userId) as { c: number };
  const plays = Number(playRow?.c) || 0;

  return {
    user,
    requestsTotal,
    requestsByStatus,
    downloads: {
      total: Number(downloadRow?.total) || 0,
      completed: Number(downloadRow?.completed) || 0,
      active: Number(downloadRow?.active) || 0,
    },
    albumsListed: personal.albums,
    libraryTracks: personal.tracks,
    listensMinutes,
    plays,
    recentRequests,
  };
}

// ─── Listening (hours played) ───────────────────────────────────────────────

/** Current UTC 3-hour bucket key, e.g. 2026-08-05T06 */
export function listenBucketKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(Math.floor(date.getUTCHours() / 3) * 3).padStart(2, "0");
  return `${y}-${m}-${d}T${h}`;
}

function bucketStartMs(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/.exec(key);
  if (!m) return 0;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    0,
    0,
    0,
  );
}

function nextBucketKey(key: string): string {
  return listenBucketKey(new Date(bucketStartMs(key) + 3 * 60 * 60 * 1000));
}

function listBucketsInclusive(fromKey: string, toKey: string): string[] {
  if (!fromKey || !toKey || fromKey > toKey) return [toKey || fromKey].filter(Boolean);
  const keys: string[] = [];
  let cur = fromKey;
  let guard = 0;
  while (cur <= toKey && guard < 10000) {
    keys.push(cur);
    if (cur === toKey) break;
    cur = nextBucketKey(cur);
    guard += 1;
  }
  return keys;
}

/** Record a play start for Recently Played (dedupes by replaying updates timestamp). */
export function recordPlay(userId: string, trackId: string) {
  if (!userId || !trackId) return;
  if (trackId.startsWith("live:")) return;
  const track = getTrack(trackId);
  if (!track) return;
  const existing = getDb()
    .prepare(
      `SELECT id, listened_seconds as listenedSeconds FROM play_history
       WHERE user_id = ? AND track_id = ?
       ORDER BY played_at DESC LIMIT 1`,
    )
    .get(userId, trackId) as
    | { id: string; listenedSeconds: number | null }
    | undefined;
  const at = nowIso();
  if (existing) {
    const secs = Math.max(Number(existing.listenedSeconds) || 0, 15);
    getDb()
      .prepare(
        `UPDATE play_history
         SET played_at = ?, listened_seconds = ?
         WHERE id = ?`,
      )
      .run(at, secs, existing.id);
  } else {
    getDb()
      .prepare(
        `INSERT INTO play_history(id, user_id, track_id, played_at, listened_seconds)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(newId(), userId, trackId, at, 15);
  }
  upsertListeningFeed(userId, trackId, at);
  // Cap history size per user
  getDb()
    .prepare(
      `DELETE FROM play_history
       WHERE user_id = ?
         AND id IN (
           SELECT id FROM (
             SELECT id FROM play_history
             WHERE user_id = ?
             ORDER BY played_at DESC
             LIMIT -1 OFFSET 100
           )
         )`,
    )
    .run(userId, userId);
}

/**
 * Credit listening time toward a track. Creates/updates play_history and
 * refreshes the household feed after the first full player heartbeat. Recent
 * history still uses the longer listen qualification threshold.
 *
 * Live/stream ids are resolved via metadata into a durable tracks row so
 * Recently played survives across sessions.
 */
export function creditTrackListen(
  userId: string,
  trackId: string,
  seconds: number,
  meta?: {
    title?: string;
    artist?: string;
    album?: string;
    coverPath?: string | null;
  },
) {
  if (!userId || !trackId) return;
  const add = Math.max(0, Math.min(3600, Number(seconds) || 0));
  if (add <= 0) return;

  let resolvedId = trackId;
  if (
    trackId.startsWith("live:") ||
    trackId.startsWith("stream:") ||
    !getTrack(trackId)
  ) {
    const title = meta?.title?.trim() || "";
    const artist = meta?.artist?.trim() || "";
    if (!title || !artist) return;
    const row = ensureHistoryTrack({
      title,
      artist,
      album: meta?.album,
      coverPath: meta?.coverPath,
    });
    if (!row) return;
    resolvedId = row.id;
  }

  const existing = getDb()
    .prepare(
      `SELECT id, listened_seconds as listenedSeconds FROM play_history
       WHERE user_id = ? AND track_id = ?
       ORDER BY played_at DESC LIMIT 1`,
    )
    .get(userId, resolvedId) as
    | { id: string; listenedSeconds: number | null }
    | undefined;

  const at = nowIso();
  let qualified = false;
  if (existing) {
    const prev = Number(existing.listenedSeconds) || 0;
    const next = prev + add;
    // Bump played_at whenever this listen qualifies (or already had).
    const bumpPlayedAt =
      next >= LISTEN_QUALIFY_SECONDS || prev >= LISTEN_QUALIFY_SECONDS;
    qualified =
      next >= LISTEN_HEARTBEAT_SECONDS ||
      prev >= LISTEN_HEARTBEAT_SECONDS;
    getDb()
      .prepare(
        `UPDATE play_history
         SET listened_seconds = ?,
             played_at = CASE WHEN ? THEN ? ELSE played_at END
         WHERE id = ?`,
      )
      .run(next, bumpPlayedAt ? 1 : 0, at, existing.id);
  } else {
    getDb()
      .prepare(
        `INSERT INTO play_history(id, user_id, track_id, played_at, listened_seconds)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(newId(), userId, resolvedId, at, add);
    qualified = add >= LISTEN_HEARTBEAT_SECONDS;
  }

  if (qualified) {
    upsertListeningFeed(userId, resolvedId, at);
  }

  getDb()
    .prepare(
      `DELETE FROM play_history
       WHERE user_id = ?
         AND id IN (
           SELECT id FROM (
             SELECT id FROM play_history
             WHERE user_id = ?
             ORDER BY played_at DESC
             LIMIT -1 OFFSET 100
           )
         )`,
    )
    .run(userId, userId);
}

/** Unique tracks recently played by user, newest first. */
export function listRecentPlays(
  userId: string,
  limit = 24,
): (TrackRow & { playedAt: string; liked: boolean })[] {
  if (!userId) return [];
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.title, t.artist, t.album, t.duration, t.path,
              t.cover_path as coverPath, t.source, t.external_id as externalId,
              t.file_size as fileSize, t.mtime_ms as mtimeMs,
              t.added_at as addedAt, t.updated_at as updatedAt,
              MAX(p.played_at) as playedAt,
              CASE WHEN EXISTS (
                SELECT 1 FROM track_likes l
                WHERE l.user_id = ? AND l.track_id = p.track_id
              ) THEN 1 ELSE 0 END as liked
       FROM play_history p
       INNER JOIN tracks t ON t.id = p.track_id
       WHERE p.user_id = ?
         AND (p.listened_seconds IS NULL OR p.listened_seconds >= 15)
         AND ${NON_ARTWORK_TRACK_FILTER_T}
       GROUP BY p.track_id
       ORDER BY playedAt DESC
       LIMIT ?`,
    )
    .all(userId, userId, limit) as Record<string, unknown>[];

  return rows.map((row) => ({
    ...mapTrack(row),
    playedAt: String(row.playedAt),
    liked: Number(row.liked) === 1,
  }));
}

/**
 * Credited listens for taste / Explore ML — includes listen depth.
 * One row per track (latest play), newest first.
 */
export function listUserListenSignals(
  userId: string,
  limit = 250,
): {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  playedAt: string;
  listenedSeconds: number;
}[] {
  if (!userId) return [];
  const rows = getDb()
    .prepare(
      `SELECT p.track_id as trackId,
              t.title as title,
              t.artist as artist,
              t.album as album,
              MAX(p.played_at) as playedAt,
              MAX(COALESCE(p.listened_seconds, 30)) as listenedSeconds
       FROM play_history p
       INNER JOIN tracks t ON t.id = p.track_id
       WHERE p.user_id = ?
         AND (p.listened_seconds IS NULL OR p.listened_seconds >= 15)
       GROUP BY p.track_id
       ORDER BY playedAt DESC
       LIMIT ?`,
    )
    .all(userId, limit) as {
    trackId: string;
    title: string;
    artist: string;
    album: string;
    playedAt: string;
    listenedSeconds: number;
  }[];

  return rows.map((r) => ({
    trackId: String(r.trackId || ""),
    title: String(r.title || ""),
    artist: String(r.artist || ""),
    album: String(r.album || ""),
    playedAt: String(r.playedAt || ""),
    listenedSeconds: Math.max(15, Number(r.listenedSeconds) || 30),
  }));
}

function listeningRowOnDisk(t: TrackRow): boolean {
  if (t.source === "stream") return false;
  const p = (t.path || "").trim();
  return Boolean(p) && !p.startsWith("stream://") && !p.startsWith("live://");
}

/** True when this row is a real on-disk library/Lidarr file. */
export function trackHasLibraryFile(t: TrackRow | null | undefined): boolean {
  if (!t) return false;
  return listeningRowOnDisk(t);
}

/**
 * Prefer an on-disk library/Lidarr copy of the same song when the given row is
 * a stream stub or a missing path (common after playlist import → later Lidarr).
 */
export function preferLibraryTrack(track: TrackRow): TrackRow {
  if (listeningRowOnDisk(track)) return track;
  const lib = findTrack(track.artist, track.title);
  if (lib && listeningRowOnDisk(lib)) return lib;
  return track;
}

/** Prefer a library/Lidarr file (and its cover) when the same song has a stream row. */
function promoteListeningRow(entry: TrackRow, next: TrackRow) {
  if (!listeningRowOnDisk(entry) && listeningRowOnDisk(next)) {
    entry.id = next.id;
    entry.path = next.path;
    entry.source = next.source;
    entry.externalId = next.externalId;
    entry.fileSize = next.fileSize;
    entry.duration = next.duration || entry.duration;
    entry.album = next.album || entry.album;
    if (next.coverPath) entry.coverPath = next.coverPath;
    return;
  }
  if (!entry.coverPath && next.coverPath) entry.coverPath = next.coverPath;
}

/**
 * Recent listens from other people on this homeserver (unique songs via
 * trackMatchKey). The viewer’s own plays never appear — adding or previewing
 * a file is not “someone else listening.”
 *
 * Reads the durable listening_feed so entries survive play_history pruning.
 */
export function listOthersListening(
  viewerUserId: string,
  limit = 16,
): (TrackRow & {
  playedAt: string;
  listenedBy: string;
  listenedByUserId: string;
  listenedByAvatarUrl: string | null;
  listeners: {
    username: string;
    userId: string;
    avatarUrl: string | null;
  }[];
})[] {
  // Fetch room for multi-listener grouping, then collapse to `limit` tracks.
  const fetchN = Math.min(Math.max(limit * 24, limit), 600);
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.title, t.artist, t.album, t.duration, t.path,
              t.cover_path as coverPath, t.source, t.external_id as externalId,
              t.file_size as fileSize, t.mtime_ms as mtimeMs,
              t.added_at as addedAt, t.updated_at as updatedAt,
              f.played_at as playedAt,
              u.id as listenedByUserId,
              u.username as listenedBy,
              u.avatar_path as listenedByAvatarPath
       FROM listening_feed f
       INNER JOIN tracks t ON t.id = f.track_id
       INNER JOIN users u ON u.id = f.user_id
       WHERE f.user_id != ?
         AND julianday(f.played_at) >= julianday('now', '-24 hours')
       ORDER BY f.played_at DESC
       LIMIT ?`,
    )
    .all(viewerUserId || "", fetchN) as Record<string, unknown>[];

  type Entry = TrackRow & {
    playedAt: string;
    listenedBy: string;
    listenedByUserId: string;
    listenedByAvatarUrl: string | null;
    listeners: {
      username: string;
      userId: string;
      avatarUrl: string | null;
    }[];
    userSeen: Set<string>;
  };

  const byKey = new Map<string, Entry>();
  const order: string[] = [];

  for (const row of rows) {
    const track = mapTrack(row);
    // Same song identity as library matching — not raw artist|title.
    // Stream rows often keep feat. / curly quotes that Lidarr files drop.
    const key =
      trackMatchKey(track.artist, track.title) ||
      `${track.artist.trim().toLowerCase()}|${track.title.trim().toLowerCase()}`;
    const userId = String(row.listenedByUserId || "");
    const username = String(row.listenedBy || "").trim();
    if (!userId || !username || userId === viewerUserId) continue;
    const avatarUrl = avatarUrlForUser(userId);

    let entry = byKey.get(key);
    if (!entry) {
      if (order.length >= limit) continue;
      entry = {
        ...track,
        playedAt: String(row.playedAt),
        listenedBy: username,
        listenedByUserId: userId,
        listenedByAvatarUrl: avatarUrl,
        listeners: [],
        userSeen: new Set(),
      };
      byKey.set(key, entry);
      order.push(key);
    } else {
      promoteListeningRow(entry, track);
      // Keep newest playedAt for the shelf ordering key already set
      if (String(row.playedAt) > entry.playedAt) {
        entry.playedAt = String(row.playedAt);
      }
    }

    if (entry.userSeen.has(userId)) continue;
    entry.userSeen.add(userId);
    entry.listeners.push({ username, userId, avatarUrl });
  }

  return order.map((key) => {
    const e = byKey.get(key)!;
    const { userSeen: _s, ...rest } = e;
    // Prefer most recent listener's display fields
    const first = rest.listeners[0];
    if (first) {
      rest.listenedBy = first.username;
      rest.listenedByUserId = first.userId;
      rest.listenedByAvatarUrl = first.avatarUrl;
    }
    return rest;
  });
}

export type StreamActivityUser = {
  username: string;
  avatarUrl: string | null;
};

/** Stream-only plays for the admin Requests activity (avatars + title). */
export type StreamedTrackActivity = {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverPath: string | null;
  createdAt: string;
  streamers: StreamActivityUser[];
};

function avatarUrlForUser(userId: string): string | null {
  if (!userId || !getUserAvatarPath(userId)) return null;
  const publicId = scrambleUserId(userId);
  return `/api/profiles/avatar/${encodeURIComponent(publicId)}`;
}

/** Lookup username → avatar chip for request activity. */
export function activityUserForUsername(
  username: string | null | undefined,
): StreamActivityUser | null {
  if (!username?.trim()) return null;
  const row = getDb()
    .prepare(
      `SELECT id, username FROM users
       WHERE lower(username) = lower(?) LIMIT 1`,
    )
    .get(username.trim()) as
    | { id: string; username: string }
    | undefined;
  if (!row) {
    return { username: username.trim(), avatarUrl: null };
  }
  return {
    username: row.username,
    avatarUrl: avatarUrlForUser(row.id),
  };
}

/**
 * Unique stream/live tracks with every household member who listened (≥15s).
 * Powers the “Streamed” filter on the Requests admin page.
 */
export function listStreamedTrackActivity(limit = 80): StreamedTrackActivity[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id as trackId, t.title, t.artist, t.album,
              t.cover_path as coverPath,
              p.played_at as playedAt,
              u.id as userId,
              u.username as username,
              u.avatar_path as avatarPath
       FROM play_history p
       INNER JOIN tracks t ON t.id = p.track_id
       INNER JOIN users u ON u.id = p.user_id
       WHERE (t.source = 'stream'
              OR t.path LIKE 'stream:%'
              OR t.path LIKE 'stream://%')
         AND (p.listened_seconds IS NULL OR p.listened_seconds >= 15)
       ORDER BY p.played_at DESC
       LIMIT ?`,
    )
    // Fetch room for multi-streamers per track
    .all(Math.min(Math.max(limit * 8, limit), 800)) as Record<string, unknown>[];

  const byTrack = new Map<
    string,
    StreamedTrackActivity & { userSeen: Set<string> }
  >();

  for (const row of rows) {
    const trackId = String(row.trackId || "");
    if (!trackId) continue;
    const username = String(row.username || "").trim();
    if (!username) continue;
    let entry = byTrack.get(trackId);
    if (!entry) {
      if (byTrack.size >= limit) continue;
      entry = {
        id: `stream:${trackId}`,
        title: String(row.title || ""),
        artist: String(row.artist || ""),
        album: String(row.album || ""),
        coverPath: (row.coverPath as string | null) ?? null,
        createdAt: String(row.playedAt || nowIso()),
        streamers: [],
        userSeen: new Set(),
      };
      byTrack.set(trackId, entry);
    }
    if (entry.userSeen.has(username.toLowerCase())) continue;
    entry.userSeen.add(username.toLowerCase());
    const userId = String(row.userId || "");
    entry.streamers.push({
      username,
      avatarUrl: avatarUrlForUser(userId),
    });
    // Keep createdAt as newest play (rows ordered DESC — first write wins)
  }

  return Array.from(byTrack.values()).map(({ userSeen: _s, ...rest }) => rest);
}

export function isTrackLiked(
  userId: string,
  trackId: string,
  meta?: LikeMeta,
): boolean {
  if (!userId || !trackId) return false;
  const ids = likeCandidateIds(trackId, meta);
  if (ids.length === 0) return false;
  const placeholders = ids.map(() => "?").join(", ");
  const row = getDb()
    .prepare(
      `SELECT 1 as ok FROM track_likes
       WHERE user_id = ? AND track_id IN (${placeholders})
       LIMIT 1`,
    )
    .get(userId, ...ids) as { ok: number } | undefined;
  return Boolean(row);
}

/** Resolve player / live / stream ids into the set of like-row keys to check. */
export function likeCandidateIds(
  trackId: string,
  meta?: LikeMeta,
): string[] {
  const ids = new Set<string>();
  const artist = meta?.artist?.trim() || "";
  const title = meta?.title?.trim() || "";

  if (trackId.startsWith("live:")) {
    // live session meta is resolved by the API; fall through on artist/title
  } else if (trackId.startsWith("stream:")) {
    ids.add(trackId);
  } else if (trackId) {
    ids.add(trackId);
    const local = getTrack(trackId);
    if (local) {
      ids.add(streamLikeId(local.artist, local.title));
    }
  }

  if (artist && title) {
    ids.add(streamLikeId(artist, title));
    const match = findTrack(artist, title);
    if (match) ids.add(match.id);
  }

  return [...ids];
}

/**
 * Canonical like key: library track id when available, else stable stream: key.
 * Returns null when we lack enough identity to store a like.
 */
export function resolveLikeTrackId(
  trackId: string,
  meta?: LikeMeta,
): { id: string; meta: Required<Pick<LikeMeta, "title" | "artist" | "album">> & {
  coverPath: string | null;
  duration: number;
} } | null {
  const artistHint = meta?.artist?.trim() || "";
  const titleHint = meta?.title?.trim() || "";
  const albumHint = meta?.album?.trim() || "";

  let library =
    trackId &&
    !trackId.startsWith("live:") &&
    !trackId.startsWith("stream:")
      ? getTrack(trackId)
      : null;

  if (!library && artistHint && titleHint) {
    library = findTrack(artistHint, titleHint);
  }

  if (library) {
    return {
      id: library.id,
      meta: {
        title: library.title,
        artist: library.artist,
        album: library.album,
        coverPath: library.coverPath,
        duration: library.duration || meta?.duration || 0,
      },
    };
  }

  const title = titleHint;
  const artist = artistHint;
  if (!title || !artist) return null;

  return {
    id: streamLikeId(artist, title),
    meta: {
      title,
      artist,
      album: albumHint || title,
      coverPath: meta?.coverPath ?? null,
      duration: meta?.duration || 0,
    },
  };
}

export function setTrackLiked(
  userId: string,
  trackId: string,
  liked: boolean,
  meta?: LikeMeta,
): boolean {
  if (!userId || !trackId) return false;
  const resolved = resolveLikeTrackId(trackId, meta);
  if (!resolved) return isTrackLiked(userId, trackId, meta);

  const aliases = likeCandidateIds(resolved.id, {
    artist: resolved.meta.artist,
    title: resolved.meta.title,
    album: resolved.meta.album,
    coverPath: resolved.meta.coverPath,
    duration: resolved.meta.duration,
  });

  const db = getDb();
  if (liked) {
    db.prepare(
      `INSERT INTO track_likes(
         user_id, track_id, liked_at, title, artist, album, cover_path, duration
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, track_id) DO UPDATE SET
         liked_at = excluded.liked_at,
         title = excluded.title,
         artist = excluded.artist,
         album = excluded.album,
         cover_path = excluded.cover_path,
         duration = excluded.duration`,
    ).run(
      userId,
      resolved.id,
      nowIso(),
      resolved.meta.title,
      resolved.meta.artist,
      resolved.meta.album,
      resolved.meta.coverPath,
      resolved.meta.duration,
    );
    // Collapse duplicate stream/library aliases for the same song
    for (const alias of aliases) {
      if (alias === resolved.id) continue;
      db.prepare(
        `DELETE FROM track_likes WHERE user_id = ? AND track_id = ?`,
      ).run(userId, alias);
    }
  } else {
    for (const alias of aliases) {
      db.prepare(
        `DELETE FROM track_likes WHERE user_id = ? AND track_id = ?`,
      ).run(userId, alias);
    }
  }
  return isTrackLiked(userId, resolved.id, resolved.meta);
}

export function toggleTrackLiked(
  userId: string,
  trackId: string,
  meta?: LikeMeta,
): boolean {
  const next = !isTrackLiked(userId, trackId, meta);
  return setTrackLiked(userId, trackId, next, meta);
}

export function countLikedTracks(userId: string): number {
  if (!userId) return 0;
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM track_likes WHERE user_id = ?`)
    .get(userId) as { c: number };
  return Number(row?.c) || 0;
}

export function listLikedTracks(
  userId: string,
  limit = 500,
): (TrackRow & { likedAt: string })[] {
  if (!userId) return [];
  const rows = getDb()
    .prepare(
      `SELECT
          l.track_id as id,
          coalesce(nullif(t.title, ''), nullif(l.title, ''), 'Unknown') as title,
          coalesce(nullif(t.artist, ''), nullif(l.artist, ''), 'Unknown') as artist,
          coalesce(nullif(t.album, ''), nullif(l.album, ''), '') as album,
          coalesce(t.duration, l.duration, 0) as duration,
          coalesce(t.path, '') as path,
          coalesce(t.cover_path, l.cover_path) as coverPath,
          coalesce(t.source, 'stream') as source,
          t.external_id as externalId,
          coalesce(t.file_size, 0) as fileSize,
          coalesce(t.mtime_ms, 0) as mtimeMs,
          coalesce(t.added_at, l.liked_at) as addedAt,
          coalesce(t.updated_at, l.liked_at) as updatedAt,
          l.liked_at as likedAt
       FROM track_likes l
       LEFT JOIN tracks t ON t.id = l.track_id
       WHERE l.user_id = ?
       ORDER BY l.liked_at DESC
       LIMIT ?`,
    )
    .all(userId, limit) as Record<string, unknown>[];

  return rows.map((row) => {
    const base = {
      id: String(row.id),
      title: String(row.title),
      artist: String(row.artist),
      album: String(row.album || row.title || ""),
      duration: Number(row.duration) || 0,
      path: String(row.path || ""),
      coverPath: (row.coverPath as string | null) || null,
      source: asTrackSource(row.source || "stream"),
      externalId: (row.externalId as string | null) || null,
      fileSize: Number(row.fileSize) || 0,
      mtimeMs: Number(row.mtimeMs) || 0,
      addedAt: String(row.addedAt),
      updatedAt: String(row.updatedAt),
      likedAt: String(row.likedAt),
    };
    if (base.path) return base;
    const hit = findTrack(base.artist, base.title);
    if (!hit?.path) return base;
    return {
      ...base,
      id: hit.id,
      title: hit.title || base.title,
      artist: hit.artist || base.artist,
      album: hit.album || base.album,
      duration: hit.duration || base.duration,
      path: hit.path,
      coverPath: hit.coverPath || base.coverPath,
      source: hit.source,
      externalId: hit.externalId ?? base.externalId,
      fileSize: hit.fileSize || base.fileSize,
      mtimeMs: hit.mtimeMs || base.mtimeMs,
    };
  });
}

/** Accumulate played seconds for a signed-in user (3-hour UTC buckets). */
export function addListenSeconds(
  userId: string,
  seconds: number,
  trackId?: string | null,
  meta?: {
    title?: string;
    artist?: string;
    album?: string;
    coverPath?: string | null;
  },
) {
  const add = Math.max(0, Math.min(3600, Number(seconds) || 0));
  if (!userId || add <= 0) return;
  const bucket = listenBucketKey();
  getDb()
    .prepare(
      `INSERT INTO listen_bucket(user_id, bucket, seconds) VALUES (?, ?, ?)
       ON CONFLICT(user_id, bucket) DO UPDATE SET
         seconds = listen_bucket.seconds + excluded.seconds`,
    )
    .run(userId, bucket, add);
  // Keep daily rollup for backwards/simple queries
  const day = bucket.slice(0, 10);
  getDb()
    .prepare(
      `INSERT INTO listen_daily(user_id, day, seconds) VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET
         seconds = listen_daily.seconds + excluded.seconds`,
    )
    .run(userId, day, add);

  if (trackId) creditTrackListen(userId, trackId, add, meta);
  else if (meta?.title && meta?.artist) {
    const row = ensureHistoryTrack({
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      coverPath: meta.coverPath,
    });
    if (row) creditTrackListen(userId, row.id, add, meta);
  }
}

export function listenTotalMinutes(): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(seconds), 0) as s FROM listen_bucket`)
    .get() as { s: number };
  return Math.round((Number(row?.s) || 0) / 60);
}

export function listenTopListener(): {
  username: string;
  minutes: number;
} | null {
  const row = getDb()
    .prepare(
      `SELECT u.username as username, COALESCE(SUM(l.seconds), 0) as s
       FROM listen_bucket l
       JOIN users u ON u.id = l.user_id
       GROUP BY l.user_id
       ORDER BY s DESC
       LIMIT 1`,
    )
    .get() as { username: string; s: number } | undefined;
  if (!row || !row.s) return null;
  return {
    username: row.username,
    minutes: Math.round(Number(row.s) / 60),
  };
}

/**
 * All-time listening: single series of total hours per 3h bucket.
 * Fills empty buckets from first listen to now.
 */
export function listenAllTimeChart(): {
  buckets: string[];
  hours: number[];
} {
  const bounds = getDb()
    .prepare(
      `SELECT MIN(bucket) as minB, MAX(bucket) as maxB FROM listen_bucket`,
    )
    .get() as { minB: string | null; maxB: string | null };

  const nowKey = listenBucketKey();
  if (!bounds?.minB) {
    return { buckets: [nowKey], hours: [0] };
  }

  const end = bounds.maxB && bounds.maxB > nowKey ? bounds.maxB : nowKey;
  const buckets = listBucketsInclusive(bounds.minB, end);
  const rows = getDb()
    .prepare(
      `SELECT bucket, SUM(seconds) as s
       FROM listen_bucket
       GROUP BY bucket`,
    )
    .all() as { bucket: string; s: number }[];
  const map = new Map(rows.map((r) => [r.bucket, Number(r.s) || 0]));
  return {
    buckets,
    hours: buckets.map((b) => Math.round(((map.get(b) ?? 0) / 3600) * 100) / 100),
  };
}

/**
 * Per-user multi-line series over last `dayCount` days (3h buckets).
 */
export function listenPerUserChart(dayCount = 14): {
  buckets: string[];
  series: { userId: string; username: string; hours: number[] }[];
} {
  const days = Math.max(1, Math.min(60, Math.floor(dayCount)));
  const now = new Date();
  const start = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - (days - 1),
      0,
      0,
      0,
      0,
    ),
  );
  const startKey = listenBucketKey(start);
  const endKey = listenBucketKey();
  const buckets = listBucketsInclusive(startKey, endKey);

  const users = listPublicProfiles();
  const rows = getDb()
    .prepare(
      `SELECT user_id as userId, bucket, seconds
       FROM listen_bucket
       WHERE bucket >= ? AND bucket <= ?`,
    )
    .all(startKey, endKey) as {
    userId: string;
    bucket: string;
    seconds: number;
  }[];

  const byUser = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let m = byUser.get(r.userId);
    if (!m) {
      m = new Map();
      byUser.set(r.userId, m);
    }
    m.set(r.bucket, Number(r.seconds) || 0);
  }

  const series = users.map((u) => {
    const m = byUser.get(u.id) ?? new Map<string, number>();
    return {
      userId: u.publicId,
      username: u.username,
      hours: buckets.map(
        (b) => Math.round(((m.get(b) ?? 0) / 3600) * 100) / 100,
      ),
    };
  });

  return { buckets, series };
}

/** Payload for admin Info listening widgets. */
export function listenDashboard(dayCount = 14) {
  return {
    totalMinutes: listenTotalMinutes(),
    topListener: listenTopListener(),
    allTime: listenAllTimeChart(),
    byUser: listenPerUserChart(dayCount),
  };
}

/** @deprecated use listenDashboard */
export function listenHoursChart(dayCount = 14) {
  const byUser = listenPerUserChart(dayCount);
  return {
    days: byUser.buckets,
    series: byUser.series,
  };
}
