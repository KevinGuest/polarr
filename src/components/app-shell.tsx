"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  AtSign,
  AudioLines,
  Ban,
  Disc3,
  DoorOpen,
  Download,
  Gauge,
  Home,
  Info,
  ListMusic,
  ListVideo,
  Mail,
  Menu,
  Mic2,
  Radio,
  Users,
  Bell,
  ChevronLeft,
  ChevronRight,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ExpandedLibraryPanel } from "@/components/expanded-library-panel";
import { LibrarySidebar } from "@/components/library-sidebar";
import { HeaderSearch } from "@/components/header-search";
import { MobileBottomDock } from "@/components/mobile-bottom-dock";
import { NowPlayingBar } from "@/components/now-playing-bar";
import { PlayerPanels, PlayerQueueRail } from "@/components/player-panels";
import { PlayerProvider } from "@/components/player-provider";
import { NotificationsBell, NotificationsLink, useNotifications } from "@/components/admin-error-notifications";
import { ProfileDrawer, UserMenu } from "@/components/user-menu";
import { AuthProvider, useAuth } from "@/components/auth-provider";
import { BanStatusBox } from "@/components/ban-status-box";
import { DesktopChromeBridge } from "@/components/desktop-chrome-bridge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePlayer } from "@/components/player-provider";
import {
  captureDesktopQueryParam,
  isOverlayTitlebar,
  isPolarrDesktop,
  markPolarrDesktop,
} from "@/lib/desktop-shell";
import { roleIsStaff } from "@/lib/roles";

const adminNavGroups = [
  {
    label: "Server",
    staff: true as const,
    items: [
      { href: "/admin", label: "Info", icon: Info },
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/bans", label: "Bans", icon: Ban },
      { href: "/admin/invites", label: "Invites", icon: Mail },
    ],
  },
  {
    label: "Media",
    staff: true as const,
    items: [
      { href: "/admin/requests", label: "Requests", icon: ListMusic },
      { href: "/admin/tracks", label: "Tracks", icon: AudioLines },
      { href: "/admin/albums", label: "Albums", icon: Disc3 },
      { href: "/admin/playlists", label: "Playlists", icon: ListVideo },
    ],
  },
  {
    label: "Settings",
    staff: false as const,
    items: [
      { href: "/admin/lidarr", label: "Sources", icon: Radio },
      { href: "/admin/quality", label: "Quality", icon: Gauge },
      { href: "/admin/import", label: "Import", icon: Download },
      { href: "/admin/lyrics", label: "Lyrics", icon: Mic2 },
      { href: "/admin/email", label: "SMTP", icon: AtSign },
      { href: "/admin/notifications", label: "Notifications", icon: Bell },
      { href: "/", label: "Exit", icon: DoorOpen },
    ],
  },
] as const;

const AUTH_PATHS = new Set([
  "/setup",
  "/login",
  "/join",
  "/forgot-password",
  "/reset-password",
]);
const MINIPLAYER_PATH = "/miniplayer";

function PolarrMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 overflow-hidden rounded-[4px]",
        className,
      )}
    >
      {/* PNG has padding around the glyph — crop in so it matches wordmark weight. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/polarr-icon.png"
        alt=""
        aria-hidden
        className="size-full scale-[1.28] object-cover mix-blend-screen"
      />
    </span>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
  compact = false,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const { setPanel } = usePlayer();
  const link = (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      onClick={() => {
        setPanel("none");
        onNavigate?.();
      }}
      className={cn(
        "flex w-full items-center rounded-md text-sm transition-colors",
        compact
          ? "justify-center px-2 py-2.5"
          : "gap-3 px-3 py-2",
        active
          ? "font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon
        className="size-[1.15rem] shrink-0"
        strokeWidth={active ? 2.25 : 1.75}
      />
      {!compact ? <span className="truncate">{label}</span> : null}
    </Link>
  );
  if (!compact) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function adminNavActive(pathname: string, href: string) {
  if (href === "/") return false;
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AdminNav({
  groups,
  pathname,
  onNavigate,
}: {
  groups: typeof adminNavGroups[number][];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="space-y-5" aria-label="Admin">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavLink
                key={item.href + item.label}
                {...item}
                active={adminNavActive(pathname, item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function mobilePageTitle(pathname: string): string | null {
  if (pathname === "/search") return "Search";
  if (pathname === "/library") return "Library";
  if (pathname === "/notifications") return "Notifications";
  return null;
}

function useDesktopShellMode() {
  // The server cannot know whether the request belongs to the Tauri shell.
  // Keep the first client render identical to SSR, then synchronize after
  // hydration. The early layout script/CSS prevents a visible web-header flash.
  const [desktopShell, setDesktopShell] = useState(false);
  const [overlayTitlebar, setOverlayTitlebar] = useState(false);
  useEffect(() => {
    captureDesktopQueryParam();
    const sync = () => {
      const on = isPolarrDesktop();
      const overlay = isOverlayTitlebar();
      setDesktopShell(on);
      setOverlayTitlebar(overlay);
      if (on) markPolarrDesktop();
    };
    sync();
    // Child webview may inject __POLARR_DESKTOP__ slightly after first paint.
    const id = window.setInterval(sync, 250);
    window.setTimeout(() => window.clearInterval(id), 12_000);
    const onStorage = () => sync();
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return { desktopShell, overlayTitlebar };
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { setPanel, track, isRemotePlayback, isPanelOpen } = usePlayer();
  const { desktopShell, overlayTitlebar } = useDesktopShellMode();
  const isSearchPage = pathname === "/search";
  const isLibraryPage = pathname === "/library";
  const isArtistPage = pathname === "/artist";
  const isAlbumPage = pathname.startsWith("/album");
  const isPlaylistPage = pathname.startsWith("/playlist");
  const isProfilePage =
    pathname === "/profile" || pathname.startsWith("/u/");
  const isNotificationsPage = pathname === "/notifications";
  const isHomePage = pathname === "/";
  const isBrowsePage = pathname.startsWith("/browse/");
  const mobileTitle =
    isSearchPage || isLibraryPage ? null : mobilePageTitle(pathname);
  const { unread: notificationUnread } = useNotifications();
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  useEffect(() => {
    setLibraryExpanded(false);
  }, [pathname]);
  const { role } = useAuth();
  const [adminNavOpen, setAdminNavOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    if (isPolarrDesktop()) return false;
    return window.matchMedia("(max-width: 1023px)").matches;
  });
  const isAdminPath =
    pathname === "/admin" || pathname.startsWith("/admin/");
  const dismissOverlays = () => setPanel("none");
  const useLibraryPageScroll = isLibraryPage && mobileViewport;
  const queueRailOpen = isPanelOpen("queue");

  useEffect(() => {
    if (desktopShell) {
      setMobileViewport(false);
      return;
    }
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setMobileViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [desktopShell]);

  const visibleAdminGroups = useMemo(() => {
    const isFullAdmin = role === "admin" || role === "owner";
    const isStaff = roleIsStaff(role);
    return adminNavGroups
      .map((group) => {
        if (group.label === "Settings") {
          // Moderators: Exit only; full Settings are admin-only.
          if (isFullAdmin) return group;
          if (isStaff) {
            return {
              ...group,
              items: group.items.filter((item) => item.href === "/"),
            };
          }
          return null;
        }
        if (!isStaff) return null;
        return group;
      })
      .filter(Boolean) as typeof adminNavGroups[number][];
  }, [role]);

  const closeAdminNav = () => setAdminNavOpen(false);

  const mainPadding = useMemo(
    () =>
      cn(
        "min-w-0 px-4 py-4 lg:px-8 lg:py-6 lg:pb-6 xl:px-10",
        isSearchPage && "max-lg:px-4 max-lg:py-0",
        isLibraryPage && "max-lg:px-4 max-lg:py-0",
        isArtistPage && "max-lg:px-4 max-lg:py-0",
        isAlbumPage && "max-lg:px-0 max-lg:py-0",
        isPlaylistPage && "max-lg:px-0 max-lg:py-0",
        isProfilePage && "max-lg:px-4 max-lg:py-0",
        isBrowsePage && "max-lg:pt-[max(1rem,calc(var(--safe-top)+0.35rem))]",
        !isAdminPath &&
          (track
            ? isRemotePlayback
              ? "max-lg:pb-[calc(var(--mobile-dock-stack)+var(--mobile-dock-player-h)+var(--mobile-connect-bar-h)+1rem)]"
              : "max-lg:pb-[calc(var(--mobile-dock-stack)+var(--mobile-dock-player-h)+1rem)]"
            : "max-lg:pb-[calc(var(--mobile-dock-stack)+1rem)]"),
      ),
    [isAdminPath, isAlbumPage, isArtistPage, isBrowsePage, isLibraryPage, isPlaylistPage, isProfilePage, isSearchPage, isRemotePlayback, track],
  );

  const adminSidebarInner = (
    <>
      <Link
        href="/admin"
        className="mb-6 flex items-center px-3 text-foreground"
        aria-label="Polarr admin"
        onClick={closeAdminNav}
      >
        <PolarrMark className="size-8" />
      </Link>
      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <AdminNav
            groups={visibleAdminGroups}
            pathname={pathname}
            onNavigate={closeAdminNav}
          />
        </ScrollArea>
        <div className="mt-auto space-y-2">
          <BanStatusBox />
          <div className="-mx-3 border-t border-border px-3 pt-3">
            <UserMenu variant="sidebar" />
          </div>
        </div>
      </div>
    </>
  );

  // Windows: native Tauri title bar owns search / alerts / profile.
  // macOS overlay: this web header IS the title bar (under traffic lights).
  const showWebHeaders = !desktopShell || overlayTitlebar;

  return (
    <div className="relative flex h-dvh flex-col bg-background text-foreground">
      {showWebHeaders && isAdminPath ? (
        <header
          data-polarr-app-header
          className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 pt-[max(0.5rem,var(--safe-top))] lg:hidden"
        >
          <button
            type="button"
            aria-label="Open admin menu"
            onClick={() => setAdminNavOpen(true)}
            className="rounded-md p-2 text-foreground"
          >
            <Menu className="size-5" />
          </button>
          <Link
            href="/admin"
            className="inline-flex shrink-0 items-center text-foreground"
            aria-label="Polarr admin"
          >
            <PolarrMark className="size-8" />
          </Link>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>
      ) : null}
      {showWebHeaders && !isAdminPath ? (
        <>
          <header
            suppressHydrationWarning
            data-polarr-app-header
            className={cn(
              "hidden shrink-0 grid-cols-[1fr_minmax(0,28rem)_1fr] items-center gap-3 border-b border-border px-5 py-3 lg:grid",
              overlayTitlebar &&
                "relative !grid h-12 min-h-12 grid-cols-1 gap-0 py-0",
            )}
          >
            {overlayTitlebar ? (
              <div
                className="relative col-span-3 grid h-full w-full items-center px-3"
                style={{
                  gridTemplateColumns: `${libraryCollapsed ? "72px" : "18rem"} minmax(0, 1fr) ${queueRailOpen ? "24rem" : "0px"}`,
                }}
              >
                <div className="absolute left-[5.5rem] top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => window.history.back()}
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Go back"
                    title="Back"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => window.history.forward()}
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Go forward"
                    title="Forward"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                </div>
                <div />
                <div className="flex min-w-0 justify-center px-3">
                  <div className="relative w-full max-w-[28rem]">
                    <div className="absolute right-[calc(100%+8px)] top-1/2 flex -translate-y-1/2 items-center">
                      <Link
                        href="/"
                        onClick={dismissOverlays}
                        className="inline-flex rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label="Home"
                      >
                        <Home className="size-4" />
                      </Link>
                    </div>
                    <Suspense
                      fallback={
                        <div className="flex h-9 w-full items-center justify-center rounded-full border border-border px-4 text-sm text-muted-foreground">
                          Search
                        </div>
                      }
                    >
                      <HeaderSearch />
                    </Suspense>
                  </div>
                </div>
                <div />
                <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center justify-end gap-1">
                  <NotificationsBell />
                  <ProfileDrawer side="right" />
                </div>
              </div>
            ) : (
              <>
                <Link
                  href="/"
                  onClick={dismissOverlays}
                  className="inline-flex w-fit items-center justify-self-start text-foreground"
                  aria-label="Polarr home"
                >
                  <PolarrMark className="size-8" />
                </Link>
                <div className="relative w-full justify-self-center">
                  <Suspense
                    fallback={
                      <div className="flex h-9 w-full items-center justify-center rounded-full border border-border px-4 text-sm text-muted-foreground">
                        Search
                      </div>
                    }
                  >
                    <HeaderSearch />
                  </Suspense>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <NotificationsBell />
                  <ProfileDrawer side="right" />
                </div>
              </>
            )}
          </header>
          <header
            data-polarr-app-header
            className={cn(
              "flex shrink-0 items-center gap-3 px-4 pb-3 pt-[max(0.75rem,var(--safe-top))] lg:hidden",
              isSearchPage && "hidden",
              isLibraryPage && "hidden",
              isArtistPage && "hidden",
              isAlbumPage && "hidden",
              isPlaylistPage && "hidden",
              isBrowsePage && "hidden",
              isProfilePage &&
                "absolute inset-x-0 top-0 z-20 bg-transparent",
            )}
          >
            {isHomePage || isProfilePage ? (
              <>
                <Link
                  href="/"
                  aria-label="Polarr home"
                  className="inline-flex shrink-0 items-center"
                >
                  <PolarrMark className="size-9" />
                </Link>
                <div className="min-w-0 flex-1" />
                <div className="flex shrink-0 items-center gap-1">
                  {!isNotificationsPage ? (
                    <NotificationsLink unread={notificationUnread} />
                  ) : null}
                  <ProfileDrawer side="right" />
                </div>
              </>
            ) : (
              <>
                {mobileTitle ? (
                  <h1 className="min-w-0 flex-1 truncate text-[1.625rem] font-bold leading-none text-foreground">
                    {mobileTitle}
                  </h1>
                ) : (
                  <div className="min-w-0 flex-1" />
                )}
                <div className="flex shrink-0 items-center gap-1">
                  {!isSearchPage && !isNotificationsPage ? (
                    <NotificationsLink unread={notificationUnread} />
                  ) : null}
                  {!isSearchPage ? <ProfileDrawer side="right" /> : null}
                </div>
              </>
            )}
          </header>
        </>
      ) : null}

      {isAdminPath && adminNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close admin menu"
            className="absolute inset-0 bg-black/60"
            onClick={closeAdminNav}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-background px-3 py-4 pt-[max(1rem,var(--safe-top))] shadow-xl">
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                aria-label="Close admin menu"
                onClick={closeAdminNav}
                className="rounded-md p-2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            {adminSidebarInner}
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1">
          {!isAdminPath && libraryExpanded ? (
            <Suspense fallback={null}>
              <ExpandedLibraryPanel
                onClose={() => setLibraryExpanded(false)}
              />
            </Suspense>
          ) : null}
          <aside
            className={cn(
              "hidden shrink-0 flex-col border-r border-border py-4 transition-[width,padding] duration-200 ease-out lg:flex",
              isAdminPath
                ? "w-56 px-3 md:w-60"
                : libraryCollapsed
                  ? "w-[72px] px-2"
                  : "w-60 px-3 md:w-72",
              libraryExpanded && "pointer-events-none",
            )}
            aria-hidden={libraryExpanded || undefined}
          >
            {isAdminPath ? (
              adminSidebarInner
            ) : (
              <TooltipProvider delayDuration={300}>
                {/* Desktop home is the titlebar mark (left of search), not the rail. */}
                <div className="mt-1 flex min-h-0 flex-1 flex-col">
                  <Suspense fallback={null}>
                    <LibrarySidebar
                      expanded={libraryExpanded}
                      onExpandedChange={setLibraryExpanded}
                      collapsed={libraryCollapsed}
                      onCollapsedChange={setLibraryCollapsed}
                    />
                  </Suspense>
                  {!libraryCollapsed ? (
                    <div className="mt-auto">
                      <BanStatusBox />
                    </div>
                  ) : null}
                </div>
              </TooltipProvider>
            )}
          </aside>

          <div
            className={cn(
              "relative min-h-0 min-w-0 flex-1",
              libraryExpanded && "pointer-events-none",
            )}
            aria-hidden={libraryExpanded || undefined}
          >
            <main className="h-full">
              {useLibraryPageScroll ? (
                <div
                  className={cn(
                    mainPadding,
                    "flex h-full min-h-0 flex-col overflow-hidden",
                  )}
                >
                  {children}
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <div className={mainPadding}>{children}</div>
                </ScrollArea>
              )}
            </main>
            {!isAdminPath && <PlayerPanels />}
          </div>
        </div>
        {!isAdminPath && <PlayerQueueRail />}
      </div>

      {!isAdminPath && <NowPlayingBar />}
      {!isAdminPath && !desktopShell && <MobileBottomDock />}
      {desktopShell && !overlayTitlebar ? (
        <ProfileDrawer
          side="right"
          showTrigger={false}
          listenForDesktopTrigger
        />
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthScreen = AUTH_PATHS.has(pathname);
  const isMiniplayer = pathname === MINIPLAYER_PATH;

  if (isAuthScreen) {
    return (
      <AuthProvider>
        <Suspense fallback={null}>
          <DesktopChromeBridge />
        </Suspense>
        <div
          data-polarr-auth
          className={cn(
            "flex bg-background text-foreground",
            "h-dvh min-h-0 overflow-y-auto overscroll-y-contain",
            "px-6 pt-[max(1.5rem,calc(var(--safe-top)+0.5rem))] pb-[max(1.25rem,calc(var(--safe-bottom)+0.75rem))]",
            "max-lg:flex-col",
            "lg:h-auto lg:min-h-dvh lg:items-center lg:justify-center lg:px-4 lg:py-12",
          )}
        >
          {children}
        </div>
      </AuthProvider>
    );
  }

  if (isMiniplayer) {
    return (
      <PlayerProvider>
        <AuthProvider>
          <Suspense fallback={null}>
            <DesktopChromeBridge />
          </Suspense>
          <div className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
            {children}
          </div>
        </AuthProvider>
      </PlayerProvider>
    );
  }

  return (
    <PlayerProvider>
      <AuthProvider>
        <Suspense fallback={null}>
          <DesktopChromeBridge />
        </Suspense>
        <ShellInner>{children}</ShellInner>
      </AuthProvider>
    </PlayerProvider>
  );
}
