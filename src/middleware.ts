import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isPublicApiRoute } from "@/lib/public-api";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

const NATIVE_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

function nativeOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (origin && NATIVE_ORIGINS.has(origin)) return origin;
  if (
    process.env.NODE_ENV !== "production" &&
    origin &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  ) {
    return origin;
  }
  return null;
}

function withNativeCors(response: NextResponse, origin: string | null) {
  if (!origin) return response;
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Range, x-polarr-mobile-platform, x-polarr-desktop-platform",
  );
  response.headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
  response.headers.set("Vary", "Origin");
  return response;
}

function isNativeMediaRequest(req: NextRequest): boolean {
  if (!req.nextUrl.searchParams.get("mediaTicket")) return false;
  return /^\/api\/(stream\/|live\/|lidarr\/cover|playlists\/[^/]+\/cover|profiles\/avatar\/|karaoke\/[^/]+\/stream)/.test(
    req.nextUrl.pathname,
  );
}

function hasAuthCredential(req: NextRequest): boolean {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();
  if (cookie && isSessionTokenShape(cookie)) return true;
  const auth = req.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return false;
  const token = auth.slice(7).trim();
  // Session tokens are 32 random bytes hex-encoded (64 chars). Rejecting
  // garbage here closes the "Authorization: Bearer x" presence-only hole;
  // handlers still call getUserByToken for real validation.
  return isSessionTokenShape(token);
}

/** Polarr session tokens are always 64 lowercase/upper hex chars. */
function isSessionTokenShape(token: string): boolean {
  return /^[a-f0-9]{64}$/i.test(token);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = nativeOrigin(req);
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (req.method === "OPTIONS" && origin) {
    return withNativeCors(new NextResponse(null, { status: 204 }), origin);
  }

  if (isPublicApiRoute(pathname, req.method) || isNativeMediaRequest(req)) {
    return withNativeCors(NextResponse.next(), origin);
  }

  if (!hasAuthCredential(req)) {
    return withNativeCors(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      origin,
    );
  }

  return withNativeCors(NextResponse.next(), origin);
}

export const config = {
  matcher: "/api/:path*",
};
