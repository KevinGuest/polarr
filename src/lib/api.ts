import { cookies, headers } from "next/headers";
import { getUserByToken } from "./db";
import { roleIsAdmin, roleIsStaff } from "./roles";

function tokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  // Fast path — avoid splitting the whole jar when possible
  const m = /(?:^|;\s*)polarr_token=([^;]+)/.exec(cookieHeader);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1].trim());
  } catch {
    return m[1].trim();
  }
}

/**
 * Sync auth from a Route Handler Request. Prefer this on hot paths
 * (stream / live) — skips Next.js async cookies()/headers() overhead.
 */
export function getAuthUserFromRequest(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return getUserByToken(auth.slice(7).trim());
  }
  return getUserByToken(tokenFromCookieHeader(req.headers.get("cookie")));
}

export function unauthorizedJson() {
  return json({ error: "Unauthorized" }, { status: 401 });
}

/** Route Handlers with a Request — stream, live, status, etc. */
export function requireAuthFromRequest(req: Request) {
  const user = getAuthUserFromRequest(req);
  if (!user) return { user: null as null, response: unauthorizedJson() };
  return { user, response: null as null };
}

/** Route Handlers using Next cookies()/headers(). */
export async function requireAuth() {
  const user = await getAuthUser();
  if (!user) return { user: null as null, response: unauthorizedJson() };
  return { user, response: null as null };
}

export async function getAuthUser() {
  const headerStore = await headers();
  const auth = headerStore.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return getUserByToken(auth.slice(7).trim());
  }
  const cookieStore = await cookies();
  const token = cookieStore.get("polarr_token")?.value;
  return getUserByToken(token);
}

/** Full admin (Settings + all panels). */
export async function getAdminUser() {
  const user = await getAuthUser();
  if (!user || !roleIsAdmin(user.role)) return null;
  return user;
}

/** Admin or moderator — Server + Media admin APIs. */
export async function getStaffUser() {
  const user = await getAuthUser();
  if (!user || !roleIsStaff(user.role)) return null;
  return user;
}

export function json(
  data: unknown,
  init?: { status?: number; headers?: Record<string, string> },
) {
  return Response.json(data, {
    status: init?.status ?? 200,
    headers: init?.headers,
  });
}
