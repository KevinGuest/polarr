"use client";

import { CoverArt } from "@/components/cover-art";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

export type ListeningAvatar = {
  username: string;
  avatarUrl?: string | null;
};

/**
 * Album cover with listener avatars (stacked). Every head drifts on its own
 * staggered cycle so multiple listeners all float, not just the lead.
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
                    "animate-listener-drift",
                    isLead ? "size-8" : "size-7 -ml-2",
                  )}
                  style={{
                    zIndex: show.length - i,
                    // Negative stagger starts extras mid-cycle: no dead wait
                    animationDelay: `${delayMs - i * 1100}ms`,
                  }}
                  title={p.username}
                >
                  <UserAvatar
                    username={p.username}
                    avatarUrl={p.avatarUrl}
                    textClassName="text-[10px] text-background"
                    className="bg-foreground text-background"
                  />
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
