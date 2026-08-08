import fs from "node:fs";
import path from "node:path";
import { getAuthUser, json } from "@/lib/api";
import { isRickrollTrack, streamPolicy } from "@/lib/bans";
import { getTrack } from "@/lib/db";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const track = getTrack(id);
  if (!track) return json({ error: "Track not found" }, { status: 404 });

  const user = await getAuthUser();
  if (user) {
    const policy = streamPolicy(user.id);
    if (!policy.ok) {
      return json(
        { error: policy.error || "Streaming banned" },
        { status: 403 },
      );
    }
    if (
      policy.forceRickroll &&
      !isRickrollTrack(track.artist, track.title)
    ) {
      return json(
        {
          error:
            "Playback restricted — only Never Gonna Give You Up is allowed.",
        },
        { status: 403 },
      );
    }
  }

  if (!fs.existsSync(track.path)) {
    return json({ error: "Audio file missing on disk" }, { status: 404 });
  }

  const stat = fs.statSync(track.path);
  const ext = path.extname(track.path).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  const range = req.headers.get("range");

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
    const stream = fs.createReadStream(track.path, { start, end });
    return new Response(stream as unknown as BodyInit, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk),
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const stream = fs.createReadStream(track.path);
  return new Response(stream as unknown as BodyInit, {
    headers: {
      "Content-Length": String(stat.size),
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
