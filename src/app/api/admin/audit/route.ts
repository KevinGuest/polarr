import { getAdminUser, json } from "@/lib/api";
import { listAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin-only read of the audit trail, newest first.
 * GET ?limit=100&before=<entry id>&event=auth.login_failed
 */
export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const limit = Number(params.get("limit") || "100");
  const before = Number(params.get("before") || "0");
  const event = (params.get("event") || "").trim().slice(0, 80);

  const entries = listAuditLog({
    limit: Number.isFinite(limit) ? limit : 100,
    before: Number.isFinite(before) && before > 0 ? before : undefined,
    event: event || undefined,
  });
  return json({
    entries,
    nextBefore: entries.length ? entries[entries.length - 1]!.id : null,
  });
}
