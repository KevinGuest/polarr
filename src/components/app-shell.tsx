"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import {
  AtSign,
  AudioLines,
  Disc3,
  DoorOpen,
  Home,
  Info,
  ListMusic,
  ListVideo,
  Mail,
  Radio,
  Users,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LibrarySidebar } from "@/components/library-sidebar";
import { HeaderSearch } from "@/components/header-search";
import { NowPlayingBar } from "@/components/now-playing-bar";
import { PlayerPanels, PlayerQueueRail } from "@/components/player-panels";
import { PlayerProvider } from "@/components/player-provider";
import { NotificationsBell } from "@/components/admin-error-notifications";
import { UserMenu } from "@/components/user-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePlayer } from "@/components/player-provider";

const primaryNav = [
  { href: "/", label: "Home", icon: Home },
];

const adminNavGroups = [
  {
    label: "Server",
    items: [
      { href: "/admin", label: "Info", icon: Info },
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/invites", label: "Invites", icon: Mail },
    ],
  },
  {
    label: "Media",
    items: [
      { href: "/admin/requests", label: "Requests", icon: ListMusic },
      { href: "/admin/tracks", label: "Tracks", icon: AudioLines },
      { href: "/admin/albums", label: "Albums", icon: Disc3 },
      { href: "/admin/playlists", label: "Playlists", icon: ListVideo },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/admin/lidarr", label: "Lidarr", icon: Radio },
      { href: "/admin/email", label: "Email", icon: AtSign },
      { href: "/admin/notifications", label: "Notifications", icon: Bell },
      { href: "/", label: "Exit", icon: DoorOpen },
    ],
  },
] as const;

const AUTH_PATHS = new Set(["/setup", "/login", "/join"]);

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
  const { setPanel } = usePlayer();
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={() => setPanel("none")}
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

function adminNavActive(pathname: string, href: string) {
  if (href === "/") return false;
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { setPanel } = usePlayer();
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const isAdmin =
    pathname === "/admin" || pathname.startsWith("/admin/");
  const dismissOverlays = () => setPanel("none");

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {!isAdmin ? (
        <header
          suppressHydrationWarning
          className="grid shrink-0 grid-cols-[1fr_minmax(0,28rem)_1fr] items-center gap-3 border-b border-border px-5 py-3"
        >
          <Link
            href="/"
            onClick={dismissOverlays}
            className="inline-flex w-fit items-center gap-2.5 justify-self-start text-foreground"
            aria-label="Polarr home"
          >
            <PolarrMark className="size-5" />
            <span className="text-base font-semibold tracking-tight">Polarr</span>
          </Link>
          <div className="relative w-full justify-self-center">
            <Suspense
              fallback={
                <div className="flex h-9 w-full items-center rounded-full border border-border pl-9 pr-4 text-sm text-muted-foreground">
                  Search artists, albums, tracks…
                </div>
              }
            >
              <HeaderSearch />
            </Suspense>
          </div>
          <div className="flex items-center justify-end gap-1">
            <NotificationsBell />
            <UserMenu />
          </div>
        </header>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "flex shrink-0 flex-col border-r border-border px-3 py-4 transition-[width] duration-200 ease-out",
            isAdmin
              ? "w-56 md:w-60"
              : libraryExpanded
                ? "w-80 md:w-96"
                : "w-56 md:w-60",
          )}
        >
          {isAdmin ? (
            <>
              <Link
                href="/admin"
                className="mb-6 flex items-center gap-2.5 px-3 text-foreground"
                aria-label="Polarr admin"
              >
                <PolarrMark className="size-5" />
                <span className="text-base font-semibold tracking-tight">
                  Polarr
                </span>
              </Link>
              <div className="flex min-h-0 flex-1 flex-col">
                <ScrollArea className="min-h-0 flex-1">
                  <nav className="space-y-5" aria-label="Admin">
                    {adminNavGroups.map((group) => (
                      <div key={group.label}>
                        <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          {group.label}
                        </p>
                        <div className="space-y-0.5">
                          {group.items.map((item) => (
                            <NavLink
                              key={item.href}
                              {...item}
                              active={adminNavActive(pathname, item.href)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </nav>
                </ScrollArea>
                <div className="mt-auto border-t border-border pt-3">
                  <UserMenu variant="sidebar" />
                </div>
              </div>
            </>
          ) : (
            <>
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
                <Suspense fallback={null}>
                  <LibrarySidebar
                    expanded={libraryExpanded}
                    onExpandedChange={setLibraryExpanded}
                  />
                </Suspense>
              </div>
            </>
          )}
        </aside>

        <div className="relative flex min-h-0 min-w-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            <main className="h-full">
              <ScrollArea className="h-full">
                <div className="px-6 py-6 md:px-8 lg:px-10">{children}</div>
              </ScrollArea>
            </main>
            {!isAdmin && <PlayerPanels />}
          </div>
          {!isAdmin && <PlayerQueueRail />}
        </div>
      </div>

      {!isAdmin && <NowPlayingBar />}
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
