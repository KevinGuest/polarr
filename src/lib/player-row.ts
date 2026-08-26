import { namesMatch, titlesMatch } from "@/lib/track-match";
import { cn } from "@/lib/utils";

type PlayerRef = {
  id: string;
  title: string;
  artist: string;
  resolveArtist?: string | null;
  album?: string | null;
} | null;

type RowRef = {
  id?: string | null;
  localTrackId?: string | null;
  streamId?: string | null;
  title?: string;
  artist?: string;
};

function artistMatches(
  current: NonNullable<PlayerRef>,
  rowArtist: string,
): boolean {
  if (namesMatch(current.artist, rowArtist)) return true;
  if (
    current.resolveArtist &&
    namesMatch(current.resolveArtist, rowArtist)
  ) {
    return true;
  }
  return false;
}

function rowMatches(current: PlayerRef, row: RowRef): boolean {
  if (!current) return false;
  const ids = [row.id, row.localTrackId, row.streamId].filter(
    (id): id is string => Boolean(id),
  );
  if (ids.includes(current.id)) return true;

  // After live/YouTube resolve the id changes — match by title + artist.
  if (row.title && titlesMatch(current.title, row.title)) {
    if (!row.artist) return true;
    if (artistMatches(current, row.artist)) return true;
  }
  return false;
}

/** True when this table row is the player’s current track. */
export function isPlayerRowCurrent(
  current: PlayerRef,
  row: RowRef,
  queue?: Array<{
    id: string;
    title: string;
    artist: string;
    resolveArtist?: string | null;
  }>,
): boolean {
  if (rowMatches(current, row)) return true;
  if (!current || !queue?.length) return false;
  const queueCurrent = queue.find((q) => q.id === current.id) ?? current;
  return rowMatches(
    {
      id: queueCurrent.id,
      title: queueCurrent.title,
      artist: queueCurrent.artist,
      resolveArtist:
        "resolveArtist" in queueCurrent
          ? queueCurrent.resolveArtist
          : current.resolveArtist,
      album: current.album,
    },
    row,
  );
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
