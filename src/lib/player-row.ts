import { namesMatch, titlesMatch } from "@/lib/track-match";
import { cn } from "@/lib/utils";

type PlayerRef = {
  id: string;
  title: string;
  artist: string;
} | null;

type RowRef = {
  id?: string | null;
  localTrackId?: string | null;
  streamId?: string | null;
  title?: string;
  artist?: string;
};

function rowMatches(current: PlayerRef, row: RowRef): boolean {
  if (!current) return false;
  const ids = [row.id, row.localTrackId, row.streamId].filter(
    (id): id is string => Boolean(id),
  );
  if (ids.includes(current.id)) return true;
  if (row.title && row.artist) {
    return (
      titlesMatch(current.title, row.title) &&
      namesMatch(current.artist, row.artist)
    );
  }
  return false;
}

/** True when this table row is the player’s current track. */
export function isPlayerRowCurrent(
  current: PlayerRef,
  row: RowRef,
  queue?: Array<{ id: string; title: string; artist: string }>,
): boolean {
  if (rowMatches(current, row)) return true;
  if (!current || !queue?.length) return false;
  const queueCurrent = queue.find((q) => q.id === current.id) ?? current;
  return rowMatches(queueCurrent, row);
}

/** Muted capsule behind a track table row (current vs hover). */
export function trackRowBg(isCurrent: boolean): string {
  return isCurrent ? "bg-muted/70" : "group-hover/row:bg-muted/30";
}

export function trackRowStartCell(isCurrent: boolean, className?: string) {
  return cn("rounded-l-full", trackRowBg(isCurrent), className);
}

export function trackRowMidCell(isCurrent: boolean, className?: string) {
  return cn(trackRowBg(isCurrent), className);
}

export function trackRowEndCell(isCurrent: boolean, className?: string) {
  return cn("rounded-r-full", trackRowBg(isCurrent), className);
}
