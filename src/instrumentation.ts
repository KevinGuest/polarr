export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLibraryScanScheduler } = await import("@/lib/library-scan-scheduler");
  startLibraryScanScheduler();

  // Keep home shelves warm in the always-on container so visitors skip cold
  // Lidarr/MB/Deezer. The feed is cached per user, so warming only the generic
  // one left every signed-in user to pay the full build on their next visit.
  // Lidarr's whole-library dumps feed covers, the sidebar and the home feed
  // and take 10+ s cold — start them now, not on the first visitor.
  void import("@/lib/lidarr")
    .then(({ LidarrClient }) => {
      const client = LidarrClient.fromSettings();
      if (!client) return;
      void client.listAlbums().catch(() => {});
      void client.listArtists().catch(() => {});
    })
    .catch(() => {});

  const { warmDiscoverFeed } = await import("@/lib/discover");
  const { listRecentlyActiveUserIds } = await import("@/lib/db");
  let warming = false;
  const warm = async () => {
    if (warming) return;
    warming = true;
    try {
      // Generic feed first: it is the instant fallback for everyone else.
      await warmDiscoverFeed(null).catch(() => {});
      let userIds: string[] = [];
      try {
        userIds = listRecentlyActiveUserIds(3 * 24 * 60 * 60_000, 12);
      } catch {
        /* DB not ready (first boot before setup) */
      }
      // One at a time — MusicBrainz rate-limits bursts.
      for (const userId of userIds) {
        await warmDiscoverFeed(userId).catch(() => {});
      }
    } finally {
      warming = false;
    }
  };
  setTimeout(() => void warm(), 8_000);
  setInterval(() => void warm(), 8 * 60_000);
}
