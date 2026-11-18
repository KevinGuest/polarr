/**
 * Durable, append-only audit trail of security-relevant events.
 *
 * Discord / email alerts are best-effort and can be switched off; this table is
 * the record of who did what and when (sign-ins and failures, role and access
 * changes, bans, invites, password and email changes, settings changes).
 * Rows are only ever inserted or aged out by retention — never edited.
 *
 * Secrets never go in here: callers pass names of changed settings, not values.
 */

import { getDb } from "@/lib/db";

/** Rows older than this are pruned. Override with POLARR_AUDIT_RETENTION_DAYS. */
const DEFAULT_RETENTION_DAYS = 400;
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;
const MAX_DETAIL_CHARS = 4000;

export type AuditEntry = {
  id: number;
  at: string;
  event: string;
  actorId: string | null;
  actorName: string | null;
  target: string | null;
  ip: string | null;
  outcome: "success" | "failure";
  detail: Record<string, unknown> | null;
};

export type AuditInput = {
  /** Stable machine name, e.g. `auth.login`, `user.role_changed`. */
  event: string;
  actor?: { id?: string | null; username?: string | null } | null;
  /** Who or what was acted on (username, playlist id, setting group…). */
  target?: string | null;
  ip?: string | null;
  outcome?: "success" | "failure";
  detail?: Record<string, unknown> | null;
};

const g = globalThis as typeof globalThis & {
  __polarrAudit?: { ready: boolean; lastPrune: number };
};

function state() {
  if (!g.__polarrAudit) g.__polarrAudit = { ready: false, lastPrune: 0 };
  return g.__polarrAudit;
}

function ensureTable() {
  const s = state();
  if (s.ready) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      event TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      target TEXT,
      ip TEXT,
      outcome TEXT NOT NULL DEFAULT 'success',
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event, at);
  `);
  s.ready = true;
}

function retentionDays(): number {
  const raw = Number(process.env.POLARR_AUDIT_RETENTION_DAYS);
  return Number.isFinite(raw) && raw >= 30 ? Math.floor(raw) : DEFAULT_RETENTION_DAYS;
}

function pruneIfDue() {
  const s = state();
  const now = Date.now();
  if (now - s.lastPrune < PRUNE_EVERY_MS) return;
  s.lastPrune = now;
  const cutoff = new Date(now - retentionDays() * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare(`DELETE FROM audit_log WHERE at < ?`).run(cutoff);
}

function clip(value: string | null | undefined, max: number): string | null {
  const v = (value || "").trim();
  return v ? v.slice(0, max) : null;
}

/** Append one audit record. Never throws — auditing must not break a request. */
export function recordAudit(input: AuditInput): void {
  try {
    ensureTable();
    let detail: string | null = null;
    if (input.detail && Object.keys(input.detail).length > 0) {
      detail = JSON.stringify(input.detail).slice(0, MAX_DETAIL_CHARS);
    }
    getDb()
      .prepare(
        `INSERT INTO audit_log(at, event, actor_id, actor_name, target, ip, outcome, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        input.event.slice(0, 80),
        clip(input.actor?.id, 64),
        clip(input.actor?.username, 80),
        clip(input.target, 200),
        clip(input.ip, 64),
        input.outcome === "failure" ? "failure" : "success",
        detail,
      );
    pruneIfDue();
  } catch (err) {
    console.error("[polarr] audit log write failed:", err instanceof Error ? err.message : err);
  }
}

/** Newest first. `before` is an entry id for keyset paging. */
export function listAuditLog(opts?: {
  limit?: number;
  before?: number;
  event?: string;
}): AuditEntry[] {
  ensureTable();
  const limit = Math.min(500, Math.max(1, Math.floor(opts?.limit ?? 100)));
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (opts?.before && Number.isFinite(opts.before)) {
    clauses.push(`id < ?`);
    params.push(Math.floor(opts.before));
  }
  if (opts?.event) {
    clauses.push(`event = ?`);
    params.push(opts.event);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `SELECT id, at, event, actor_id as actorId, actor_name as actorName,
              target, ip, outcome, detail
       FROM audit_log ${where}
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(...params, limit) as (Omit<AuditEntry, "detail"> & {
    detail: string | null;
  })[];
  return rows.map((row) => {
    let detail: Record<string, unknown> | null = null;
    if (row.detail) {
      try {
        detail = JSON.parse(row.detail) as Record<string, unknown>;
      } catch {
        detail = { raw: row.detail };
      }
    }
    return { ...row, detail };
  });
}
