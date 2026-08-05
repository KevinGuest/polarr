"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Headphones,
  Home,
  ListMusic,
  Search,
  Settings,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NowPlayingBar } from "@/components/now-playing-bar";
import { PlayerProvider, usePlayer } from "@/components/player-provider";

const primaryNav = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
];

const libraryNav = [
  { href: "/library", label: "Library", icon: Headphones },
  { href: "/requests", label: "Requests", icon: ListMusic },
  { href: "/mobile", label: "Mobile", icon: Smartphone },
  { href: "/settings", label: "Admin", icon: Settings },
];

const AUTH_PATHS = new Set(["/setup", "/login"]);

function PolarrMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <rect x="2.5" y="11" width="2.75" height="8" rx="1.25" />
      <rect x="7.25" y="6" width="2.75" height="13" rx="1.25" />
      <rect x="12" y="9" width="2.75" height="10" rx="1.25" />
      <rect x="16.75" y="3.5" width="2.75" height="15.5" rx="1.25" />
    </svg>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Home;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon
        className="size-[1.15rem] shrink-0"
        strokeWidth={active ? 2.25 : 1.75}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function CoverTile({ seed }: { seed: string }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const a = 20 + (h % 40);
  const b = 40 + ((h >> 3) % 35);
  return (
    <div
      className="size-full"
      style={{
        backgroundImage: `linear-gradient(${h % 360}deg, hsl(0 0% ${a}%), hsl(0 0% ${b}%), hsl(0 0% ${Math.min(a + 25, 70)}%))`,
      }}
      aria-hidden
    />
  );
}

function SidebarNowPlaying() {
  const { track } = usePlayer();
  if (!track) return null;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border">
      <div className="aspect-square w-full bg-muted">
        <CoverTile seed={track.title} />
      </div>
      <div className="space-y-0.5 px-3 py-2.5">
        <div className="truncate text-sm font-medium">{track.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {track.artist}
        </div>
      </div>
    </div>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border px-3 py-4 md:w-60">
        <Link
          href="/"
          className="mb-6 flex items-center gap-2.5 px-3 text-foreground"
          aria-label="Polarr home"
        >
          <PolarrMark className="size-5" />
          <span className="text-base font-semibold tracking-tight">Polarr</span>
        </Link>

        <nav className="space-y-0.5" aria-label="Primary">
          {primaryNav.map((item) => (
            <NavLink
              key={item.href}
              {...item}
              active={
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href)
              }
            />
          ))}
        </nav>

        <div className="mt-6 flex min-h-0 flex-1 flex-col">
          <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Library
          </p>
          <nav className="space-y-0.5 overflow-y-auto" aria-label="Library">
            {libraryNav.map((item) => (
              <NavLink
                key={item.href}
                {...item}
                active={pathname.startsWith(item.href)}
              />
            ))}
          </nav>
        </div>

        <SidebarNowPlaying />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-border px-5 py-3">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Link
              href="/search"
              className="flex h-9 w-full items-center rounded-full border border-border bg-transparent pl-9 pr-4 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              Search artists, albums, tracks…
            </Link>
          </div>
          <div className="ml-auto flex size-8 items-center justify-center rounded-full border border-border text-xs font-medium">
            P
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        <NowPlayingBar />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthScreen = AUTH_PATHS.has(pathname);

  if (isAuthScreen) {
    return (
      <PlayerProvider>
        <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
          {children}
        </div>
      </PlayerProvider>
    );
  }

  return (
    <PlayerProvider>
      <ShellInner>{children}</ShellInner>
    </PlayerProvider>
  );
}
