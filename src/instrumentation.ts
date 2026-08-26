export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLibraryScanScheduler } = await import(
    "@/lib/library-scan-scheduler"
  );
  startLibraryScanScheduler();

  // Keep home shelves warm in the always-on container so visitors skip cold Lidarr/MB/Deezer.
  const { getDiscoverFeed } = await import("@/lib/discover");
  const warm = () => {
    void getDiscoverFeed(null).catch(() => {});
  };
  setTimeout(warm, 8_000);
  setInterval(warm, 8 * 60_000);
}
