import { json } from "@/lib/api";
import { listDownloads } from "@/lib/db";
import { enqueueFallbackDownload, processDownloadJob } from "@/lib/fallback-download";
import { albumCoverKey, getAlbumCoverMap } from "@/lib/lidarr";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const covers = await getAlbumCoverMap();
  const downloads = listDownloads().map((d) => {
    const album = (d.title || "").trim();
    const coverPath = album
      ? covers.get(albumCoverKey(d.artist, album)) || null
      : null;
    return { ...d, coverPath };
  });
  return json({ downloads });
}

const schema = z.object({
  query: z.string().min(1),
  title: z.string().optional(),
  artist: z.string().optional(),
  jobId: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.jobId) {
    await processDownloadJob(parsed.data.jobId);
    return json({ ok: true });
  }
  const job = await enqueueFallbackDownload(parsed.data);
  return json({ job });
}
