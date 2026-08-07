"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";

/** How many equal-width tiles fit in one row (no horizontal scroll). */
export function useFitCount(minItemPx = 144, gapPx = 20) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(6);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    const n = Math.max(2, Math.floor((w + gapPx) / (minItemPx + gapPx)));
    setCount(n);
  }, [minItemPx, gapPx]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return { ref, count };
}

export function ShelfHeader({
  title,
  eyebrow,
  leading,
  showSeeAll,
  seeAllHref,
  onSeeAll,
  titleAs = "h2",
}: {
  title: string;
  /** Small label above the title, e.g. “More from”. */
  eyebrow?: string;
  leading?: ReactNode;
  showSeeAll?: boolean;
  seeAllHref?: string;
  onSeeAll?: () => void;
  titleAs?: "h1" | "h2";
}) {
  const Title = titleAs;
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p>
          ) : null}
          <Title
            className={
              titleAs === "h1"
                ? "truncate text-xl font-semibold tracking-tight text-foreground md:text-2xl"
                : eyebrow
                  ? "truncate text-xl font-semibold tracking-tight text-foreground"
                  : "truncate text-lg font-semibold tracking-tight text-foreground"
            }
          >
            {title}
          </Title>
        </div>
      </div>
      {showSeeAll && onSeeAll ? (
        <button
          type="button"
          onClick={onSeeAll}
          className="shrink-0 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Show all
        </button>
      ) : showSeeAll && seeAllHref ? (
        <Link
          href={seeAllHref}
          className="shrink-0 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Show all
        </Link>
      ) : null}
    </div>
  );
}

/** Single-row shelf: only items that fit; no overflow scroll. */
export function MediaShelfRow({
  title,
  eyebrow,
  leading,
  seeAllHref,
  onSeeAll,
  itemCount,
  minItemPx = 144,
  gapPx = 20,
  empty,
  children,
}: {
  title: string;
  eyebrow?: string;
  leading?: ReactNode;
  seeAllHref?: string;
  onSeeAll?: () => void;
  /** Total items available (used for See all). */
  itemCount: number;
  minItemPx?: number;
  gapPx?: number;
  empty?: ReactNode;
  children: (visible: number) => ReactNode;
}) {
  const { ref, count } = useFitCount(minItemPx, gapPx);
  const showSeeAll = Boolean((seeAllHref || onSeeAll) && itemCount > count);

  return (
    <section className="space-y-4">
      <ShelfHeader
        title={title}
        eyebrow={eyebrow}
        leading={leading}
        showSeeAll={showSeeAll}
        seeAllHref={seeAllHref}
        onSeeAll={onSeeAll}
      />
      {itemCount === 0 ? (
        empty
      ) : (
        <div
          ref={ref}
          className="grid justify-start"
          style={{
            gap: gapPx,
            // Cap tile width so covers don't balloon on wide layouts
            gridTemplateColumns: `repeat(${count}, minmax(0, 9rem))`,
          }}
        >
          {children(count)}
        </div>
      )}
    </section>
  );
}

/** Full "See all" multi-row grid (Spotify Made For You style). */
export function MediaShelfGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        className ??
        "grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7"
      }
    >
      {children}
    </div>
  );
}

export function MediaTileShell({
  cover,
  title,
  subtitle,
  onOpen,
  ariaLabel,
  badge,
  playButton,
  coverShape = "square",
}: {
  cover: ReactNode;
  title: string;
  subtitle: string;
  onOpen: () => void;
  ariaLabel: string;
  badge?: ReactNode;
  playButton?: ReactNode;
  /** Artist tiles use circle — avoids square frame around a round face. */
  coverShape?: "square" | "circle";
}) {
  return (
    <div className="min-w-0 space-y-2.5">
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          className={
            coverShape === "circle"
              ? "relative block aspect-square w-full overflow-hidden rounded-full bg-muted text-left shadow-sm transition-opacity hover:opacity-90"
              : "relative block aspect-square w-full overflow-hidden rounded-md bg-muted text-left shadow-sm transition-opacity hover:opacity-90"
          }
          aria-label={ariaLabel}
        >
          <div className="absolute inset-0">{cover}</div>
          {badge}
        </button>
        {playButton}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full space-y-0.5 text-left"
      >
        <div className="line-clamp-1 text-sm font-semibold leading-snug tracking-tight text-foreground">
          {title}
        </div>
        <div className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {subtitle}
        </div>
      </button>
    </div>
  );
}
