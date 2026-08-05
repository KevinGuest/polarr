import type { DragEvent } from "react";
import type { PlayerTrack } from "@/components/player-provider";

export const POLARR_TRACK_MIME = "application/x-polarr-track";

export function setDragTrack(event: DragEvent, track: PlayerTrack): void {
  const payload = JSON.stringify(track);
  event.dataTransfer.setData(POLARR_TRACK_MIME, payload);
  event.dataTransfer.setData("text/plain", payload);
  event.dataTransfer.effectAllowed = "copy";
}

export function getDragTrack(event: DragEvent): PlayerTrack | null {
  const raw =
    event.dataTransfer.getData(POLARR_TRACK_MIME) ||
    event.dataTransfer.getData("text/plain");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PlayerTrack;
    if (!parsed?.title || !parsed?.artist) return null;
    return {
      id: parsed.id || `stream:${parsed.artist}:${parsed.title}`,
      title: parsed.title,
      artist: parsed.artist,
      album: parsed.album || "",
      coverPath: parsed.coverPath ?? null,
      streamUrl: parsed.streamUrl ?? null,
      explicit: parsed.explicit,
    };
  } catch {
    return null;
  }
}
