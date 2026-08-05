import { json } from "@/lib/api";
import { listTracks } from "@/lib/db";
import { scanMusicLibrary } from "@/lib/library";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("scan") === "1") {
    const result = scanMusicLibrary();
    return json({ ...result, tracks: listTracks(200) });
  }
  return json({ tracks: listTracks(200) });
}

export async function POST() {
  const result = scanMusicLibrary();
  return json({ ...result, tracks: listTracks(200) });
}
