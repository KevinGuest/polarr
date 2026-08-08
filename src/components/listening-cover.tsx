"use client";

import { CoverArt } from "@/components/cover-art";
import { cn } from "@/lib/utils";

export type ListeningAvatar = {
  username: string;
  avatarUrl?: string | null;
};

/**
 * Album cover with listener avatars (stacked). One head drifts; extras sit
 * stacked under it so multiple listeners show up on the same track.
 */
export function ListeningCover({
  title,
  coverPath,
  listenedBy,
  avatarUrl,
  listeners,
  delayMs = 0,
}: {
  title: string;
  coverPath?: string | null;
  /** @deprecated prefer listeners */
  listenedBy?: string;
  /** @deprecated prefer listeners */
  avatarUrl?: string | null;
  listeners?: ListeningAvatar[];
  /** Stagger start across a shelf row */
  delayMs?: number;
}) {
  const people: ListeningAvatar[] =
    listeners && listeners.length > 0
      ? listeners
      : listenedBy
        ? [{ username: listenedBy, avatarUrl }]
        : [];

  const show = people.slice(0, 4);
  const rest = people.length - show.length;

  return (
    <div className="relative size-full overflow-hidden">
      <CoverArt seed={title} image={coverPath} className="size-full" />
      {show.length > 0 ? (
        <div
          className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-end"
          title={people.map((p) => p.username).join(", ")}
          aria-hidden
        >
          <div className="flex items-end">
            {show.map((p, i) => {
              const isLead = i === 0;
              return (
                <span
                  key={`${p.username}-${i}`}
                  className={cn(
                    "relative overflow-hidden rounded-full border-2 border-white/90 shadow-md",
                    isLead ? "size-8 animate-listener-drift" : "size-7 -ml-2",
                  )}
                  style={{
                    zIndex: show.length - i,
                    ...(isLead ? { animationDelay: `${delayMs}ms` } : {}),
                  }}
                  title={p.username}
                >
                  <AvatarFace username={p.username} avatarUrl={p.avatarUrl} />
                </span>
              );
            })}
            {rest > 0 ? (
              <span
                className="relative -ml-2 flex size-7 items-center justify-center rounded-full border-2 border-white/90 bg-foreground text-[9px] font-semibold text-background shadow-md"
                style={{ zIndex: 0 }}
                title={`+${rest} more`}
              >
                +{rest}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AvatarFace({
  username,
  avatarUrl,
}: {
  username: string;
  avatarUrl?: string | null;
}) {
  const initial = (username.trim()[0] || "?").toUpperCase();
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt="" className="size-full object-cover" />
    );
  }
  return (
    <div className="flex size-full items-center justify-center bg-foreground text-[10px] font-semibold text-background">
      {initial}
    </div>
  );
}
