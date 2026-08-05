"use client";

import { CoverArt } from "@/components/cover-art";

/** Album cover with listener avatar drifting in from bottom-left, then fading. */
export function ListeningCover({
  title,
  coverPath,
  listenedBy,
  avatarUrl,
  delayMs = 0,
}: {
  title: string;
  coverPath?: string | null;
  listenedBy: string;
  avatarUrl?: string | null;
  /** Stagger start across a shelf row */
  delayMs?: number;
}) {
  const initial = (listenedBy.trim()[0] || "?").toUpperCase();

  return (
    <div className="relative size-full overflow-hidden">
      <CoverArt seed={title} image={coverPath} className="size-full" />
      <div
        className="pointer-events-none absolute bottom-1.5 left-1.5 size-8 overflow-hidden rounded-full border-2 border-white/90 shadow-md animate-listener-drift"
        style={{ animationDelay: `${delayMs}ms` }}
        aria-hidden
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center bg-foreground text-[11px] font-semibold text-background">
            {initial}
          </div>
        )}
      </div>
    </div>
  );
}
