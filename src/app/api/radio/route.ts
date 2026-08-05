import { getAuthUser, json } from "@/lib/api";
import { getTrack } from "@/lib/db";
import { buildSongRadio } from "@/lib/made-for";

export const dynamic = "force-dynamic";

/** Song radio: streamable tracks related to a seed track. */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const trackId = new URL(req.url).searchParams.get("trackId") || "";
  if (!trackId) return json({ error: "trackId required" }, { status: 400 });

  const seed = getTrack(trackId);
  if (!seed) return json({ error: "Track not found" }, { status: 404 });

  const tracks = buildSongRadio(user.id, seed);
  return json({
    seed: {
      id: seed.id,
      title: seed.title,
      artist: seed.artist,
      album: seed.album,
    },
    tracks,
  });
}
