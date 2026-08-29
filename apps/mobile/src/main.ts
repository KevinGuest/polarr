import { Preferences } from "@capacitor/preferences";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import "./styles.css";

const SERVER_KEY = "polarr_server_url";

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <main class="shell">
    <div class="card">
      <img class="logo" src="/polarr-icon.png" alt="Polarr" width="72" height="72" />
      <h1>Polarr</h1>
      <p class="lede" id="lede">Connect to your self-hosted music hub.</p>
      <form id="server-form" autocomplete="on">
        <label for="server-url">Server URL</label>
        <input
          id="server-url"
          name="serverUrl"
          type="url"
          inputmode="url"
          enterkeyhint="go"
          placeholder="http://192.168.1.10:3647"
          required
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
        />
        <p id="error" class="error" hidden></p>
        <button type="submit" id="connect">Connect</button>
      </form>
      <button type="button" id="reset" class="ghost" hidden>Change server</button>
    </div>
  </main>
  <div id="toast" class="toast" hidden role="status"></div>
`;

const form = document.querySelector<HTMLFormElement>("#server-form")!;
const input = document.querySelector<HTMLInputElement>("#server-url")!;
const errorEl = document.querySelector<HTMLParagraphElement>("#error")!;
const button = document.querySelector<HTMLButtonElement>("#connect")!;
const resetBtn = document.querySelector<HTMLButtonElement>("#reset")!;
const lede = document.querySelector<HTMLParagraphElement>("#lede")!;
const toastEl = document.querySelector<HTMLDivElement>("#toast")!;

let toastTimer: number | null = null;

function showToast(message: string) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
    toastTimer = null;
  }, 4200);
}

function showError(message: string) {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function looksLikePolarr(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  if (o.app === "polarr") return true;
  return o.status === "ok" && "setupComplete" in o && "hasUsers" in o;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Enter your Polarr server URL.");
  const withScheme =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported.");
  }
  if (!parsed.hostname) throw new Error("URL must include a host.");

  const host = parsed.hostname;
  if (!host.includes(".") && host.toLowerCase() !== "localhost") {
    parsed.hostname = `${host}.local`;
  }

  return parsed.toString().replace(/\/+$/, "");
}

async function probePolarr(base: string): Promise<void> {
  const paths = ["/api/v1/status", "/api/status"];
  for (const path of paths) {
    try {
      let body: unknown;
      if (Capacitor.isNativePlatform()) {
        const response = await CapacitorHttp.get({
          url: `${base}${path}`,
          connectTimeout: 4000,
          readTimeout: 4000,
        });
        if (response.status < 200 || response.status >= 300) continue;
        body = response.data;
      } else {
        const response = await fetch(`${base}${path}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) continue;
        body = await response.json();
      }
      if (looksLikePolarr(body)) return;
    } catch {
      continue;
    }
  }
  throw new Error("URL not valid");
}

async function saveUrl(url: string) {
  await Preferences.set({ key: SERVER_KEY, value: url });
  localStorage.setItem(SERVER_KEY, url);
}

async function loadUrl(): Promise<string | null> {
  const fromPrefs = await Preferences.get({ key: SERVER_KEY });
  if (fromPrefs.value) return fromPrefs.value;
  return localStorage.getItem(SERVER_KEY);
}

async function clearUrl() {
  await Preferences.remove({ key: SERVER_KEY });
  localStorage.removeItem(SERVER_KEY);
}

function goToServer(url: string) {
  // Full navigation keeps cookies/session on the Polarr origin (httpOnly polarr_token).
  window.location.replace(url);
}

async function bootstrapNativeChrome() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    // Status bar plugin may be unavailable in browser preview.
  }
}

async function bootstrap() {
  await bootstrapNativeChrome();

  const params = new URLSearchParams(window.location.search);
  if (params.get("reset") === "1" || window.location.hash === "#reset") {
    await clearUrl();
    history.replaceState({}, "", window.location.pathname);
  }

  const existing = await loadUrl();
  if (!existing) return;

  input.value = existing;
  resetBtn.hidden = false;
  form.hidden = true;
  lede.textContent = "Opening your Polarr server…";
  button.textContent = "Open now";

  let cancelled = false;
  resetBtn.addEventListener(
    "click",
    async () => {
      cancelled = true;
      await clearUrl();
      form.hidden = false;
      resetBtn.hidden = true;
      input.value = "";
      lede.textContent = "Connect to your self-hosted music hub.";
      button.disabled = false;
      button.textContent = "Connect";
      clearError();
    },
    { once: true },
  );

  // Short grace period so users can tap Change server without reinstalling.
  await new Promise((r) => setTimeout(r, 1200));
  if (cancelled) return;

  try {
    const url = normalizeUrl(existing);
    await probePolarr(url);
    if (url !== existing) await saveUrl(url);
    goToServer(url);
  } catch {
    form.hidden = false;
    resetBtn.hidden = false;
    lede.textContent = "Connect to your self-hosted music hub.";
    button.disabled = false;
    button.textContent = "Connect";
    showToast("URL not valid");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  button.disabled = true;
  button.textContent = "Checking…";
  try {
    const url = normalizeUrl(input.value);
    await probePolarr(url);
    await saveUrl(url);
    button.textContent = "Connecting…";
    goToServer(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showToast("URL not valid");
    showError(message || "URL not valid");
    button.disabled = false;
    button.textContent = "Connect";
  }
});

void bootstrap();
