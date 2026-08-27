import fs from "node:fs";
import path from "node:path";
import { getAuthUserFromRequest, json } from "@/lib/api";
import { isRickrollTrack, streamPolicy } from "@/lib/bans";
import { getTrack } from "@/lib/db";
import { resolvePlayableAudioPath } from "@/lib/audio-path";

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

  const user = getAuthUserFromRequest(req);
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

  const filePath = resolvePlayableAudioPath(track.path);
  if (!filePath) {
    const { notifyDiscordStreamError } = await import("@/lib/admin-notify");
    notifyDiscordStreamError({
      dedupeKey: `missing:${track.id}`,
      title: "Stream error — file missing",
      description: `${track.title} by ${track.artist}`,
      fields: [
        { name: "Track", value: track.title, inline: true },
        { name: "Artist", value: track.artist, inline: true },
        { name: "Path", value: (track.path || "").slice(0, 200) },
      ],
    });
    return json({ error: "Audio file missing on disk" }, { status: 404 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return json({ error: "Audio file missing on disk" }, { status: 404 });
  }
  if (!stat.isFile()) {
    return json({ error: "Audio file missing on disk" }, { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  const range = req.headers.get("range");
  // Immutable library files — allow browser reuse across seeks / next-track prefetch
  const cacheControl = "private, max-age=86400, immutable";

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
        "Cache-Control": cacheControl,
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(stream as unknown as BodyInit, {
    headers: {
      "Content-Length": String(stat.size),
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
    },
  });
}
