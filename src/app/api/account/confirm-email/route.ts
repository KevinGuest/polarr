import { NextResponse } from "next/server";
import { confirmEmailChange, getSettings } from "@/lib/db";
import { resolvePublicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const result = token
    ? confirmEmailChange(token)
    : { ok: false as const, error: "Missing confirmation token" };
  const base = resolvePublicBaseUrl(getSettings(), req) || url.origin;
  const status = result.ok ? "confirmed" : "invalid";
  return NextResponse.redirect(`${base}/settings?tab=account&email=${status}`);
}
