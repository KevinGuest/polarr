import { json, getAuthUser } from "@/lib/api";
import {
  clearLibraryPin,
  isLibraryPinned,
  listLibraryPins,
  setLibraryPin,
} from "@/lib/db";

export const dynamic = "force-dynamic";

/** List pinned library sidebar keys for the current user. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  return json({
    pins: listLibraryPins(user.id).map((p) => p.itemKey),
  });
}

/** Pin or unpin a sidebar item. Body: { itemKey, pinned: boolean } */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    itemKey?: string;
    pinned?: boolean;
  } | null;
  const itemKey = (body?.itemKey || "").trim().slice(0, 400);
  if (!itemKey) return json({ error: "itemKey required" }, { status: 400 });

  const pinned = body?.pinned !== false;
  if (pinned) setLibraryPin(user.id, itemKey);
  else clearLibraryPin(user.id, itemKey);

  return json({
    ok: true,
    itemKey,
    pinned: isLibraryPinned(user.id, itemKey),
  });
}
