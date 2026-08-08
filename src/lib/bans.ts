/**
 * User ban system — stream, download, and full user lockout with optional expiry.
 * Stream + download together → only “Never Gonna Give You Up” may be played.
 */
import { randomBytes } from "node:crypto";
import { getDb } from "./db";

export const RICKROLL = {
  artist: "Rick Astley",
  title: "Never Gonna Give You Up",
  album: "Whenever You Need Somebody",
} as const;

export type ActiveBan = {
  stream: boolean;
  download: boolean;
  user: boolean;
  /** null = permanent */
  expiresAt: string | null;
  reason: string | null;
  /** Newest matching ban id (for lift UI). */
  id: string;
  createdAt: string;
};

export type BanRow = {
  id: string;
  userId: string;
  username: string;
  stream: boolean;
  download: boolean;
  user: boolean;
  expiresAt: string | null;
  reason: string | null;
  createdBy: string | null;
  createdByUsername: string | null;
  createdAt: string;
  liftedAt: string | null;
  active: boolean;
};

function banId() {
  return randomBytes(12).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function isNotExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return true;
  return t > Date.now();
}

export function ensureUserBansTable() {
  getDb().exec(`
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
  `);
  try {
    getDb().exec(
      `CREATE INDEX IF NOT EXISTS idx_user_bans_user ON user_bans(user_id)`,
    );
  } catch {
    /* ignore */
  }
}

export function isRickrollTrack(artist: string, title: string): boolean {
  const a = artist.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  return (
    a.includes("rick astley") &&
    (t.includes("never gonna give you up") || t.includes("never gonna"))
  );
}

/** Merge all still-active (not lifted, not expired) ban rows for a user. */
export function getActiveBan(userId: string): ActiveBan | null {
  if (!userId) return null;
  ensureUserBansTable();
  const rows = getDb()
    .prepare(
      `SELECT id, ban_stream as stream, ban_download as download,
              ban_user as userBan, expires_at as expiresAt, reason,
              created_at as createdAt
       FROM user_bans
       WHERE user_id = ? AND lifted_at IS NULL
       ORDER BY created_at DESC`,
    )
    .all(userId) as {
    id: string;
    stream: number;
    download: number;
    userBan: number;
    expiresAt: string | null;
    reason: string | null;
    createdAt: string;
  }[];

  let stream = false;
  let download = false;
  let user = false;
  let expiresAt: string | null | undefined = undefined;
  let reason: string | null = null;
  let id = "";
  let createdAt = "";
  let any = false;
  let permanent = false;
  let furthest = 0;

  for (const r of rows) {
    if (!isNotExpired(r.expiresAt)) continue;
    any = true;
    if (!id) {
      id = r.id;
      createdAt = r.createdAt;
      reason = r.reason;
    }
    if (r.stream) stream = true;
    if (r.download) download = true;
    if (r.userBan) user = true;
    if (r.expiresAt == null) {
      permanent = true;
    } else {
      const t = Date.parse(r.expiresAt);
      if (Number.isFinite(t) && t > furthest) {
        furthest = t;
        if (!permanent) expiresAt = r.expiresAt;
      }
    }
  }

  if (!any) return null;

  return {
    stream,
    download,
    user,
    expiresAt: permanent ? null : expiresAt ?? null,
    reason,
    id,
    createdAt,
  };
}

export function getActiveBanByUsername(username: string): ActiveBan | null {
  if (!username?.trim()) return null;
  const row = getDb()
    .prepare(`SELECT id FROM users WHERE lower(username) = lower(?) LIMIT 1`)
    .get(username.trim()) as { id: string } | undefined;
  if (!row) return null;
  return getActiveBan(row.id);
}

export function banLabel(ban: ActiveBan): string {
  if (!ban.expiresAt) return "permanent";
  try {
    return new Date(ban.expiresAt).toLocaleString();
  } catch {
    return ban.expiresAt;
  }
}

export function banToastMessage(ban: ActiveBan): string {
  if (!ban.expiresAt) return "You’re permanently banned.";
  return `You’re banned until ${banLabel(ban)}.`;
}

export function banPublicPayload(ban: ActiveBan | null) {
  if (!ban) return null;
  return {
    stream: ban.stream,
    download: ban.download,
    user: ban.user,
    expiresAt: ban.expiresAt,
    permanent: ban.expiresAt == null,
    reason: ban.reason,
    label: ban.expiresAt == null ? "Permanent" : `Until ${banLabel(ban)}`,
    rickroll: ban.stream && ban.download,
  };
}

export function createUserBan(input: {
  userId: string;
  stream: boolean;
  download: boolean;
  user: boolean;
  /** null = permanent */
  expiresAt?: string | null;
  reason?: string | null;
  createdBy?: string | null;
  createdByUsername?: string | null;
}): BanRow {
  ensureUserBansTable();
  if (!input.stream && !input.download && !input.user) {
    throw new Error("Select at least one ban type");
  }
  const user = getDb()
    .prepare(`SELECT id, username, role FROM users WHERE id = ?`)
    .get(input.userId) as
    | { id: string; username: string; role: string | null }
    | undefined;
  if (!user) throw new Error("User not found");
  if ((user.role || "member").toLowerCase() === "owner") {
    throw new Error("Cannot ban the server owner");
  }
  if (input.createdBy && input.createdBy === user.id) {
    throw new Error("You can’t ban yourself");
  }

  const id = banId();
  const createdAt = nowIso();
  const expiresAt = input.expiresAt?.trim() || null;
  getDb()
    .prepare(
      `INSERT INTO user_bans(
         id, user_id, ban_stream, ban_download, ban_user,
         expires_at, reason, created_by, created_by_username, created_at, lifted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      id,
      user.id,
      input.stream ? 1 : 0,
      input.download ? 1 : 0,
      input.user ? 1 : 0,
      expiresAt,
      input.reason?.trim() || null,
      input.createdBy ?? null,
      input.createdByUsername ?? null,
      createdAt,
    );

  // User ban ends sessions immediately (same idea as revoke).
  if (input.user) {
    getDb().prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id);
  }

  return {
    id,
    userId: user.id,
    username: user.username,
    stream: input.stream,
    download: input.download,
    user: input.user,
    expiresAt,
    reason: input.reason?.trim() || null,
    createdBy: input.createdBy ?? null,
    createdByUsername: input.createdByUsername ?? null,
    createdAt,
    liftedAt: null,
    active: true,
  };
}

export function liftUserBan(banId: string): boolean {
  ensureUserBansTable();
  const r = getDb()
    .prepare(
      `UPDATE user_bans SET lifted_at = ?
       WHERE id = ? AND lifted_at IS NULL`,
    )
    .run(nowIso(), banId);
  return r.changes > 0;
}

export function listBans(limit = 100): BanRow[] {
  ensureUserBansTable();
  const rows = getDb()
    .prepare(
      `SELECT b.id, b.user_id as userId, u.username,
              b.ban_stream as stream, b.ban_download as download,
              b.ban_user as userBan, b.expires_at as expiresAt,
              b.reason, b.created_by as createdBy,
              b.created_by_username as createdByUsername,
              b.created_at as createdAt, b.lifted_at as liftedAt
       FROM user_bans b
       INNER JOIN users u ON u.id = b.user_id
       ORDER BY b.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    userId: string;
    username: string;
    stream: number;
    download: number;
    userBan: number;
    expiresAt: string | null;
    reason: string | null;
    createdBy: string | null;
    createdByUsername: string | null;
    createdAt: string;
    liftedAt: string | null;
  }[];

  return rows.map((r) => {
    const notLifted = !r.liftedAt;
    const active = notLifted && isNotExpired(r.expiresAt);
    return {
      id: r.id,
      userId: r.userId,
      username: r.username,
      stream: Boolean(r.stream),
      download: Boolean(r.download),
      user: Boolean(r.userBan),
      expiresAt: r.expiresAt,
      reason: r.reason,
      createdBy: r.createdBy,
      createdByUsername: r.createdByUsername,
      createdAt: r.createdAt,
      liftedAt: r.liftedAt,
      active,
    };
  });
}

/**
 * Stream policy for a user.
 * - ok + forceRickroll: only Never Gonna Give You Up
 * - deny: blocked
 */
export function streamPolicy(userId: string | null | undefined): {
  ok: boolean;
  forceRickroll: boolean;
  error?: string;
} {
  if (!userId) return { ok: true, forceRickroll: false };
  const ban = getActiveBan(userId);
  if (!ban) return { ok: true, forceRickroll: false };
  if (ban.user) {
    return { ok: false, forceRickroll: false, error: "You’re banned." };
  }
  if (ban.stream && ban.download) {
    return { ok: true, forceRickroll: true };
  }
  if (ban.stream) {
    return {
      ok: false,
      forceRickroll: false,
      error: "Streaming is banned on your account.",
    };
  }
  return { ok: true, forceRickroll: false };
}

export function downloadPolicy(userId: string | null | undefined): {
  ok: boolean;
  error?: string;
} {
  if (!userId) return { ok: true };
  const ban = getActiveBan(userId);
  if (!ban) return { ok: true };
  if (ban.user) {
    return { ok: false, error: "You’re banned." };
  }
  if (ban.download) {
    return {
      ok: false,
      error: "Downloads are banned on your account.",
    };
  }
  return { ok: true };
}

/** Duration helper: hours from now → ISO, null permanent. */
export function expiresAtFromDuration(
  kind: "permanent" | "1h" | "24h" | "7d" | "30d" | "custom",
  customIso?: string | null,
): string | null {
  if (kind === "permanent") return null;
  if (kind === "custom") {
    if (!customIso?.trim()) throw new Error("Pick an end date");
    const t = Date.parse(customIso);
    if (!Number.isFinite(t) || t <= Date.now()) {
      throw new Error("End date must be in the future");
    }
    return new Date(t).toISOString();
  }
  const ms: Record<string, number> = {
    "1h": 3600_000,
    "24h": 86_400_000,
    "7d": 7 * 86_400_000,
    "30d": 30 * 86_400_000,
  };
  return new Date(Date.now() + (ms[kind] || 0)).toISOString();
}
