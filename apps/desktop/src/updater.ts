import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Use the plugin default platform keys (`darwin-aarch64` / `darwin-x86_64`,
 * plus `-app` / Windows NSIS variants). Do not pass a custom `target` —
 * CI publishes those keys for the universal `.app.tar.gz`, not `macos-universal`.
 */
export function updaterCheckOptions(): { timeout: number } {
  // The updater window gates startup, so a slow or unreachable GitHub must not
  // hold the app closed. A missed check simply retries on the next launch.
  return { timeout: UPDATE_CHECK_TIMEOUT_MS };
}

/** Longest the startup update check may delay the app (ms). */
export const UPDATE_CHECK_TIMEOUT_MS = 5_000;

export type UpdateProgress = {
  received: number;
  total: number | null;
};

export async function getAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "0.0.0";
  }
}

export async function findAppUpdate(): Promise<Update | null> {
  try {
    // Belt and braces: the plugin timeout covers the request, this covers a
    // stalled DNS lookup / IPC call that never reaches it.
    const timedOut = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), UPDATE_CHECK_TIMEOUT_MS + 1_500);
    });
    return (await Promise.race([check(updaterCheckOptions()), timedOut])) ?? null;
  } catch (err) {
    console.error("polarr updater: check failed", err);
    return null;
  }
}

export async function downloadAndRelaunch(
  update: Update,
  onProgress: (progress: UpdateProgress) => void,
): Promise<void> {
  let received = 0;
  let total: number | null = null;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        received = 0;
        total = event.data.contentLength ?? null;
        onProgress({ received, total });
        break;
      case "Progress":
        received += event.data.chunkLength;
        onProgress({ received, total });
        break;
      case "Finished":
        onProgress({ received: total ?? received, total });
        break;
    }
  });

  await relaunch();
}
