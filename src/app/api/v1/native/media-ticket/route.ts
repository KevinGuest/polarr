import { getAuthUserFromRequest, json } from "@/lib/api";
import { issueNativeMediaTicket } from "@/lib/native-media-ticket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const credential = auth?.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!credential || !getAuthUserFromRequest(req)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  return json(issueNativeMediaTicket(credential));
}

