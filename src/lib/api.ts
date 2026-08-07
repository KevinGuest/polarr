import { cookies, headers } from "next/headers";
import { getUserByToken } from "./db";
import { roleIsAdmin, roleIsStaff } from "./roles";

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
