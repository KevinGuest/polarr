import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { downloadAndRelaunch, findAppUpdate } from "./updater";

const win = getCurrentWindow();
const titleEl = document.querySelector<HTMLDivElement>("#title")!;
const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const barEl = document.querySelector<HTMLDivElement>("#bar")!;
const fillEl = document.querySelector<HTMLDivElement>("#fill")!;
const actionsEl = document.querySelector<HTMLDivElement>("#actions")!;
const closeBtn = document.querySelector<HTMLButtonElement>("#close-btn")!;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setChecking() {
  statusEl.classList.remove("wrap");
  titleEl.textContent = "Polarr";
  statusEl.textContent = "Checking for updates…";
  barEl.classList.add("indeterminate");
  fillEl.style.width = "";
}

function setDownloading(version: string, received: number, total: number | null) {
  titleEl.textContent = `Updating to ${version}`;
  barEl.classList.remove("indeterminate");
  if (total && total > 0) {
    const pct = Math.min(100, Math.round((received / total) * 100));
    fillEl.style.width = `${pct}%`;
    statusEl.textContent = `${formatBytes(received)} of ${formatBytes(total)}`;
    barEl.setAttribute("aria-valuenow", String(pct));
  } else {
    barEl.classList.add("indeterminate");
    fillEl.style.width = "";
    statusEl.textContent = received > 0 ? `Downloading… ${formatBytes(received)}` : "Downloading…";
  }
}

function setInstalling() {
  titleEl.textContent = "Polarr";
  statusEl.textContent = "Installing…";
  barEl.classList.add("indeterminate");
  fillEl.style.width = "";
}

function setError(message: string) {
  titleEl.textContent = "Update failed";
  statusEl.classList.add("wrap");
  statusEl.textContent = message;
  barEl.classList.remove("indeterminate");
  fillEl.style.width = "0";
  actionsEl.classList.add("visible");
  void win.setSize(new LogicalSize(360, 196)).catch(() => null);
}

closeBtn.addEventListener("click", () => {
  void win.close();
});

async function reveal() {
  try {
    await win.show();
  } catch {
    /* ignore */
  }
}

async function run() {
  setChecking();
  await reveal();

  const update = await findAppUpdate();
  if (!update) {
    await win.close();
    return;
  }

  try {
    setDownloading(update.version, 0, null);
    await downloadAndRelaunch(update, ({ received, total }) => {
      if (total && received >= total) {
        setInstalling();
        return;
      }
      setDownloading(update.version, received, total);
    });
  } catch {
    setError("Couldn't install. Try again next launch, or download from GitHub Releases.");
  }
}

void run();
