"use client";

import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Large carousel tile — ~2.2 covers + peek. */
const MOBILE_TILE_LARGE =
  "w-[calc((100%-0.75rem)/2.35)] max-w-[9.75rem] shrink-0 snap-start";

/** Compact carousel tile — ~3.2 covers + peek. */
const MOBILE_TILE_COMPACT =
  "w-[calc((100%-1.5rem)/3.25)] max-w-[6.75rem] shrink-0 snap-start";

function mobileTileClass(size: "large" | "compact") {
  return size === "compact" ? MOBILE_TILE_COMPACT : MOBILE_TILE_LARGE;
}

/** How many equal-width tiles fit in one row (no horizontal scroll). */
export function useFitCount(minItemPx = 128, gapPx = 16) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(8);

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

export function InsetGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl bg-white/[0.06] [&>*+*]:border-t [&>*+*]:border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BrowsePageHeader({
  title,
  backHref = "/",
  backLabel = "Home",
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className="space-y-2">
      <Link
        href={backHref}
        className="-ml-1 inline-flex items-center text-[17px] text-muted-foreground lg:hidden"
      >
        <ChevronLeft className="size-6" strokeWidth={1.75} />
        {backLabel}
      </Link>
      <div className="flex items-center gap-3">
        <Link
          href={backHref}
          className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground lg:inline-flex"
          aria-label={`Back to ${backLabel}`}
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="min-w-0 text-[2rem] font-semibold tracking-tight">
          {title}
        </h1>
      </div>
    </header>
  );
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
  const titleClass =
    titleAs === "h1"
      ? "truncate text-[2rem] font-semibold tracking-tight text-foreground"
      : "truncate text-[1.375rem] font-semibold leading-tight tracking-tight text-foreground";
  const chevron =
    showSeeAll ? (
      <ChevronRight
        className="size-5 shrink-0 text-muted-foreground max-lg:hidden"
        aria-hidden
      />
    ) : null;

  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[11px] font-medium leading-none text-muted-foreground lg:text-xs">
              {eyebrow}
            </p>
          ) : null}
          <div className="flex min-w-0 items-center gap-0.5">
            <Title className={titleClass}>{title}</Title>
            {showSeeAll && seeAllHref ? (
              <Link
                href={seeAllHref}
                className="max-lg:hidden"
                aria-label={`Show all ${title}`}
              >
                {chevron}
              </Link>
            ) : showSeeAll && onSeeAll ? (
              <button
                type="button"
                onClick={onSeeAll}
                className="max-lg:hidden"
                aria-label={`Show all ${title}`}
              >
                {chevron}
              </button>
            ) : (
              chevron
            )}
          </div>
        </div>
      </div>
      {showSeeAll && onSeeAll ? (
        <button
          type="button"
          onClick={onSeeAll}
          className="shrink-0 text-[15px] font-normal text-muted-foreground transition-colors hover:text-foreground lg:text-sm lg:font-medium"
        >
          Show all
        </button>
      ) : showSeeAll && seeAllHref ? (
        <Link
          href={seeAllHref}
          className="shrink-0 text-[15px] font-normal text-muted-foreground transition-colors hover:text-foreground lg:text-sm lg:font-medium"
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
  minItemPx = 128,
  gapPx = 16,
  fillRow = true,
  mobileTileSize = "large",
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
  /**
   * When true (default), leftover width grows the tiles so the row is full.
   * When false, keep a full set of columns so a short list stays compact.
   */
  fillRow?: boolean;
  /** Mobile horizontal scroll tile width — large (~2+peek) or compact (~3+peek). */
  mobileTileSize?: "large" | "compact";
  empty?: ReactNode;
  children: (visible: number) => ReactNode;
}) {
  const { ref, count } = useFitCount(minItemPx, gapPx);
  const visible = Math.min(count, Math.max(itemCount, 0));
  const columns = fillRow ? Math.max(visible, 1) : count;
  const showSeeAll = Boolean((seeAllHref || onSeeAll) && itemCount > 0);
  const items = itemCount > 0 ? children(visible) : null;
  const mobileItems =
    itemCount > 0 ? children(Math.min(itemCount, 24)) : null;

  return (
    <section className="space-y-3 lg:space-y-4">
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
        <>
          <div
            className={cn(
              "-mr-4 flex gap-3 overflow-x-auto overscroll-x-contain pr-4 pb-0.5",
              "snap-x snap-mandatory [scrollbar-width:none] lg:hidden",
              "[&::-webkit-scrollbar]:hidden",
            )}
          >
            {Children.toArray(mobileItems).map((child, i) => (
              <div key={i} className={mobileTileClass(mobileTileSize)}>
                {child}
              </div>
            ))}
          </div>
          <div
            ref={ref}
            className="hidden w-full lg:grid"
            style={{
              gap: gapPx,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {items}
          </div>
        </>
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
        "grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8"
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
  compact = false,
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
  /** Tighter text for compact mobile carousels (~3 across). */
  compact?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-2 lg:space-y-2.5">
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          className={
            coverShape === "circle"
              ? "relative block aspect-square w-full overflow-hidden rounded-full bg-muted text-left transition-opacity hover:opacity-90"
              : "relative block aspect-square w-full overflow-hidden rounded-2xl bg-muted text-left shadow-sm transition-opacity hover:opacity-90"
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
        <div
          className={cn(
            "font-medium leading-snug text-foreground",
            compact
              ? "line-clamp-1 text-[13px] lg:line-clamp-1 lg:text-sm"
              : "line-clamp-2 text-[13px] lg:line-clamp-1 lg:text-sm",
          )}
        >
          {title}
        </div>
        <div
          className={cn(
            "leading-snug text-muted-foreground",
            compact
              ? "line-clamp-1 text-[11px] lg:text-xs"
              : "line-clamp-2 text-xs",
          )}
        >
          {subtitle}
        </div>
      </button>
    </div>
  );
}
