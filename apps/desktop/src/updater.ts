import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Universal macOS builds use a custom updater target in latest.json. */
export function updaterCheckOptions() {
  if (typeof navigator !== "undefined" && navigator.platform?.includes("Mac")) {
    return { target: "macos-universal" as const };
  }
  return {};
}

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
    return (await check(updaterCheckOptions())) ?? null;
  } catch {
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
