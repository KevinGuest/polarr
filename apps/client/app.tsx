import { Suspense, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppShell } from "../../src/components/app-shell";
import { AppToaster } from "../../src/components/app-toaster";
import { HomeClient } from "../../src/components/home-client";
import { LoginForm } from "../../src/components/login-form";
import { ForgotPasswordForm } from "../../src/components/forgot-password-form";
import { JoinForm } from "../../src/components/join-form";
import { ResetPasswordForm } from "../../src/components/reset-password-form";
import { SetupWizard } from "../../src/components/setup-wizard";
import { LibraryClient } from "../../src/components/library-client";
import { LibrarySidebar } from "../../src/components/library-sidebar";
import { ArtistClient } from "../../src/components/artist-client";
import { AlbumClient } from "../../src/components/album-client";
import { PlaylistClient } from "../../src/components/playlist-client";
import { FolderClient } from "../../src/components/folder-client";
import { SearchClient } from "../../src/components/search-client";
import { SettingsClient } from "../../src/components/settings-client";
import { ProfileClient } from "../../src/components/profile-client";
import { TopTracksClient } from "../../src/components/top-tracks-client";
import { RecentClient } from "../../src/components/recent-client";
import { NotificationsClient } from "../../src/components/notifications-client";
import { JamClient } from "../../src/components/jam-client";
import { MiniplayerClient } from "../../src/components/miniplayer-client";
import { BrowseArtistsClient } from "../../src/components/browse-artists-client";
import { BrowseExploreClient } from "../../src/components/browse-explore-client";
import { BrowseListeningClient } from "../../src/components/browse-listening-client";
import { BrowseReleasesClient } from "../../src/components/browse-releases-client";
import { AdminInfoClient } from "../../src/components/admin-info-client";
import { AdminUsersClient } from "../../src/components/admin-users-client";
import { AdminBansClient } from "../../src/components/admin-bans-client";
import { AdminInvitesClient } from "../../src/components/admin-invites-client";
import { RequestsClient } from "../../src/components/requests-client";
import { AdminMediaClient } from "../../src/components/admin-media-client";
import { AdminPlaylistsClient } from "../../src/components/admin-playlists-client";
import { AdminLidarrClient } from "../../src/components/admin-lidarr-client";
import { AdminQualityClient } from "../../src/components/admin-quality-client";
import { AdminImportClient } from "../../src/components/admin-import-client";
import { AdminLyricsClient } from "../../src/components/admin-lyrics-client";
import { AdminEmailClient } from "../../src/components/admin-email-client";
import { AdminNotificationsClient } from "../../src/components/admin-notifications-client";
import { useAuth } from "../../src/components/auth-provider";
import { nativeSessionToken } from "../../src/lib/native-client";
import { navigate, usePathname } from "./navigation";
import { installNativeRuntime } from "./runtime";

function segment(pathname: string, prefix: string) {
  return decodeURIComponent(pathname.slice(prefix.length).split("/")[0] || "");
}

function NativeRoute() {
  const pathname = usePathname();
  const auth = useAuth();
  const publicPath = new Set([
    "/login",
    "/join",
    "/forgot-password",
    "/reset-password",
    "/setup",
  ]).has(pathname);

  useEffect(() => {
    if (!publicPath && !auth.loading && !auth.user) navigate("/login", true);
    if (publicPath && auth.user) navigate("/", true);
  }, [auth.loading, auth.user, publicPath]);

  if (pathname === "/login") return <LoginForm />;
  if (pathname === "/forgot-password") return <ForgotPasswordForm />;
  if (pathname === "/join") return <JoinForm />;
  if (pathname === "/reset-password") return <ResetPasswordForm />;
  if (pathname === "/setup") return <SetupWizard />;
  if (pathname === "/") return <HomeClient />;
  if (pathname === "/library") {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col lg:hidden"><LibrarySidebar variant="page" /></div>
        <div className="hidden lg:block"><LibraryClient /></div>
      </>
    );
  }
  if (pathname === "/library/liked") return <LibraryClient mode="liked" />;
  if (pathname === "/artist") return <ArtistClient />;
  if (pathname.startsWith("/album/")) return <AlbumClient albumId={segment(pathname, "/album/")} />;
  if (pathname.startsWith("/playlist/")) return <PlaylistClient playlistId={segment(pathname, "/playlist/")} />;
  if (pathname.startsWith("/folder/")) return <FolderClient folderId={segment(pathname, "/folder/")} />;
  if (pathname === "/search") return <SearchClient />;
  if (pathname === "/settings") return <SettingsClient />;
  if (pathname === "/profile") return <ProfileClient />;
  if (pathname === "/profile/top-tracks") return <TopTracksClient />;
  if (pathname.startsWith("/u/") && pathname.endsWith("/top-tracks")) {
    return <TopTracksClient username={segment(pathname, "/u/")} />;
  }
  if (pathname.startsWith("/u/")) return <ProfileClient username={segment(pathname, "/u/")} />;
  if (pathname === "/recent") return <RecentClient />;
  if (pathname === "/notifications") return <NotificationsClient />;
  if (pathname === "/jam") return <JamClient />;
  if (pathname === "/miniplayer") return <MiniplayerClient />;
  if (pathname === "/queue") {
    navigate("/", true);
    return null;
  }
  if (pathname === "/requests") {
    navigate("/admin/requests", true);
    return null;
  }
  if (pathname === "/browse/artists") return <BrowseArtistsClient />;
  if (pathname === "/browse/explore") return <BrowseExploreClient />;
  if (pathname === "/browse/listening") return <BrowseListeningClient />;
  if (pathname === "/browse/releases") return <BrowseReleasesClient />;
  if (pathname === "/admin") return <AdminInfoClient />;
  if (pathname === "/admin/users") return <AdminUsersClient />;
  if (pathname === "/admin/bans") return <AdminBansClient />;
  if (pathname === "/admin/invites") return <AdminInvitesClient />;
  if (pathname === "/admin/requests") return <RequestsClient />;
  if (pathname === "/admin/tracks") return <AdminMediaClient mode="tracks" />;
  if (pathname === "/admin/albums") return <AdminMediaClient mode="albums" />;
  if (pathname === "/admin/playlists") return <AdminPlaylistsClient />;
  if (pathname === "/admin/lidarr") return <AdminLidarrClient />;
  if (pathname === "/admin/quality") return <AdminQualityClient />;
  if (pathname === "/admin/import") return <AdminImportClient />;
  if (pathname === "/admin/lyrics") return <AdminLyricsClient />;
  if (pathname === "/admin/email") return <AdminEmailClient />;
  if (pathname === "/admin/notifications") return <AdminNotificationsClient />;
  return <HomeClient />;
}

function NativeApp() {
  return (
    <AppShell>
      <Suspense fallback={null}><NativeRoute /></Suspense>
    </AppShell>
  );
}

const roots = new WeakMap<HTMLElement, Root>();

export function unmountPolarrClient(element: HTMLElement) {
  roots.get(element)?.unmount();
  roots.delete(element);
  element.innerHTML = "";
}

export async function mountPolarrClient(
  element: HTMLElement,
  options: {
    serverUrl: string;
    platform: "ios" | "desktop";
    version?: string;
    changeServer?: () => void | Promise<void>;
  },
) {
  await installNativeRuntime(
    options.serverUrl,
    options.platform,
    options.version,
    options.changeServer,
  );
  if (!window.location.hash) {
    navigate(nativeSessionToken() ? "/" : "/login", true);
  }
  element.innerHTML = "";
  const root = roots.get(element) || createRoot(element);
  roots.set(element, root);
  root.render(
    <>
      <NativeApp />
      <AppToaster />
    </>,
  );
}
