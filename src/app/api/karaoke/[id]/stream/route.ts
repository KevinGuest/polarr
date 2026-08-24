import fs from "node:fs";
import { getInstrumentalFile, type KaraokeRequestMeta } from "@/lib/karaoke-stems";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

function metaFromUrl(req: Request): KaraokeRequestMeta {
  const url = new URL(req.url);
  return {
    artist: url.searchParams.get("artist") || undefined,
    title: url.searchParams.get("title") || undefined,
    album: url.searchParams.get("album") || undefined,
  };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const filePath = getInstrumentalFile(id, metaFromUrl(req));
  if (!filePath) {
    return json(
      { error: "Instrumental not ready. Request separation first." },
      { status: 404 },
    );
  }

  const stat = fs.statSync(filePath);
  const range = req.headers.get("range");
  const contentType = "audio/mp4";

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (!match) {
      return new Response("Invalid range", { status: 416 });
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (start >= stat.size || end >= stat.size) {
      return new Response("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    const chunk = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(stream as unknown as BodyInit, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk),
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(stream as unknown as BodyInit, {
    headers: {
      "Content-Length": String(stat.size),
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
