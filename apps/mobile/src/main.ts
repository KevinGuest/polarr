import { Preferences } from "@capacitor/preferences";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Capacitor } from "@capacitor/core";
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
        <p class="hint">Same URL you use in Safari. Umbrel default port is 3647. HTTP on your LAN is OK.</p>
        <p id="error" class="error" hidden></p>
        <button type="submit" id="connect">Connect</button>
      </form>
      <button type="button" id="reset" class="ghost" hidden>Change server</button>
    </div>
  </main>
`;

const form = document.querySelector<HTMLFormElement>("#server-form")!;
const input = document.querySelector<HTMLInputElement>("#server-url")!;
const errorEl = document.querySelector<HTMLParagraphElement>("#error")!;
const button = document.querySelector<HTMLButtonElement>("#connect")!;
const resetBtn = document.querySelector<HTMLButtonElement>("#reset")!;
const lede = document.querySelector<HTMLParagraphElement>("#lede")!;

function showError(message: string) {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
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
  if (!parsed.host) throw new Error("URL must include a host.");
  return withScheme.replace(/\/+$/, "");
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
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0c0b12" });
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
  if (!cancelled) goToServer(existing);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();
  button.disabled = true;
  button.textContent = "Connecting…";
  try {
    const url = normalizeUrl(input.value);
    await saveUrl(url);
    goToServer(url);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    button.disabled = false;
    button.textContent = "Connect";
  }
});

void bootstrap();
