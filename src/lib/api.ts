import { cookies, headers } from "next/headers";
import { getUserByToken } from "./db";

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

/** Returns the signed-in admin user, or null. */
export async function getAdminUser() {
  const user = await getAuthUser();
  if (!user?.isAdmin) return null;
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
