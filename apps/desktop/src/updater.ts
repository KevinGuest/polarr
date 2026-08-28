import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

let pendingUpdate: Update | null = null;
let checking = false;

/** Universal macOS builds use a custom updater target in latest.json. */
function updaterCheckOptions() {
  if (typeof navigator !== "undefined" && navigator.platform?.includes("Mac")) {
    return { target: "macos-universal" as const };
  }
  return {};
}

export function getPendingUpdate(): Update | null {
  return pendingUpdate;
}

export async function getAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "0.0.0";
  }
}

export async function checkForAppUpdate(opts?: {
  silent?: boolean;
}): Promise<"none" | "available" | "error"> {
  if (checking) return pendingUpdate ? "available" : "none";
  checking = true;
  try {
    const update = await check(updaterCheckOptions());
    pendingUpdate = update ?? null;
    if (!update) return "none";
    return "available";
  } catch {
    pendingUpdate = null;
    return opts?.silent ? "none" : "error";
  } finally {
    checking = false;
  }
}

export async function installPendingUpdate(): Promise<boolean> {
  const update = pendingUpdate;
  if (!update) return false;

  await update.downloadAndInstall();
  pendingUpdate = null;
  await relaunch();
  return true;
}
