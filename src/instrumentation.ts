export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLibraryScanScheduler } = await import(
    "@/lib/library-scan-scheduler"
  );
  startLibraryScanScheduler();
}
