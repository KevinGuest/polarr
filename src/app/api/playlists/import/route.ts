import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import {
  importPlaylistForUser,
  importPlaylistFromRows,
  PLAYLIST_IMPORT_MAX,
} from "@/lib/playlist-import";
import {
  fetchRemotePlaylist,
  spotifyImportConfigured,
  type PlaylistService,
} from "@/lib/playlist-services";

export const dynamic = "force-dynamic";

const urlSchema = z.object({
  service: z.enum(["spotify", "youtube", "deezer", "apple"]),
  url: z.string().min(8).max(2000),
  name: z.string().min(1).max(80).optional(),
});

const textSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  text: z.string().min(1).max(2_000_000),
});

export async function GET() {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  return json({
    services: {
      spotify: spotifyImportConfigured(),
      youtube: true,
      deezer: true,
      apple: false,
    },
    maxTracks: PLAYLIST_IMPORT_MAX,
  });
}

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return json({ error: "Invalid form data" }, { status: 400 });
    let name = "Imported playlist";
    const nameField = form.get("name");
    if (typeof nameField === "string" && nameField.trim()) {
      name = nameField.trim().slice(0, 80);
    }
    const file = form.get("file");
    const textField = form.get("text");
    let text = "";
    if (file instanceof File) text = await file.text();
    else if (typeof textField === "string") text = textField;
    if (!text.trim()) {
      return json({ error: "Paste or upload a playlist export" }, { status: 400 });
    }
    const result = await importPlaylistForUser(user.id, name, text);
    if ("error" in result) {
      return json({ error: result.error }, { status: 400 });
    }
    return json({ ...result, maxTracks: PLAYLIST_IMPORT_MAX });
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  if ("url" in raw && "service" in raw) {
    const parsed = urlSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "Provide a service and playlist URL." }, { status: 400 });
    }
    const remote = await fetchRemotePlaylist(
      parsed.data.service as PlaylistService,
      parsed.data.url,
    );
    if ("error" in remote) {
      return json({ error: remote.error }, { status: 400 });
    }
    const result = await importPlaylistFromRows(
      user.id,
      parsed.data.name?.trim() || remote.name,
      remote.tracks,
    );
    if ("error" in result) {
      return json({ error: result.error }, { status: 400 });
    }
    return json({
      ...result,
      service: remote.service,
      maxTracks: PLAYLIST_IMPORT_MAX,
    });
  }

  const parsed = textSchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      { error: "Provide a playlist URL (preferred) or CSV/text export." },
      { status: 400 },
    );
  }
  const result = await importPlaylistForUser(
    user.id,
    parsed.data.name?.trim() || "Imported playlist",
    parsed.data.text,
  );
  if ("error" in result) {
    return json({ error: result.error }, { status: 400 });
  }
  return json({ ...result, maxTracks: PLAYLIST_IMPORT_MAX });
}
