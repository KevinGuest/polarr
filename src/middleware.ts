import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isPublicApiRoute } from "@/lib/public-api";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

function hasAuthCredential(req: NextRequest): boolean {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();
  if (token) return true;
  const auth = req.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return false;
  return auth.slice(7).trim().length > 0;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (isPublicApiRoute(pathname, req.method)) {
    return NextResponse.next();
  }

  if (!hasAuthCredential(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
