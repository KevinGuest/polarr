import { json } from "@/lib/api";
import { getTrack, markOffline } from "@/lib/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const track = getTrack(id);
  if (!track) return json({ error: "Not found" }, { status: 404 });
  return json({
    track: {
      ...track,
      streamUrl: `/api/stream/${track.id}`,
      downloadUrl: `/api/stream/${track.id}?download=1`,
    },
  });
}

const offlineSchema = z.object({
  deviceId: z.string().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const track = getTrack(id);
  if (!track) return json({ error: "Not found" }, { status: 404 });
  const body = offlineSchema.safeParse(await req.json().catch(() => ({})));
  markOffline(id, body.success ? body.data.deviceId : undefined);
  return json({
    ok: true,
    offline: {
      trackId: id,
      streamUrl: `/api/stream/${id}`,
      title: track.title,
      artist: track.artist,
      album: track.album,
    },
  });
}
