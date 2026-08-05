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

export function json(
  data: unknown,
  init?: { status?: number; headers?: Record<string, string> },
) {
  return Response.json(data, {
    status: init?.status ?? 200,
    headers: init?.headers,
  });
}
