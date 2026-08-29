/**
 * Best-effort User-Agent parsing for admin/Discord alerts.
 *
 * The Polarr desktop (Tauri) and mobile (Capacitor) apps run inside the
 * system webview and do not set a custom UA, so the platform/device we can
 * report is whatever the underlying browser exposes. This is purely for
 * human-readable notifications — never for auth or access decisions.
 */

export type ClientDescription = {
  /** Human client label, e.g. "Chrome on Windows" or "Safari on iOS". */
  platform: string;
  /** Specific hardware model when the UA names one (mobile), else null. */
  device: string | null;
};

function detectOs(agent: string): string | null {
  if (/iPhone|iPod/i.test(agent)) return "iOS";
  if (/iPad/i.test(agent)) return "iPadOS";
  if (/Android/i.test(agent)) return "Android";
  if (/CrOS/i.test(agent)) return "ChromeOS";
  if (/Windows NT|Windows Phone|Windows/i.test(agent)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(agent)) return "macOS";
  if (/Linux/i.test(agent)) return "Linux";
  return null;
}

function detectBrowser(agent: string): string | null {
  // Order matters: chromium-based browsers all embed "Chrome"/"Safari".
  if (/Edg(?:iOS|A)?\//i.test(agent) || /\bEdge\//i.test(agent)) return "Edge";
  if (/OPR\/|\bOpera\//i.test(agent)) return "Opera";
  if (/SamsungBrowser\//i.test(agent)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//i.test(agent)) return "Firefox";
  if (/CriOS\/|Chrome\/|Chromium\//i.test(agent)) return "Chrome";
  if (/Safari\//i.test(agent)) return "Safari";
  return null;
}

function detectDevice(agent: string): string | null {
  if (/iPhone/i.test(agent)) return "iPhone";
  if (/iPad/i.test(agent)) return "iPad";
  if (/iPod/i.test(agent)) return "iPod";
  if (/Android/i.test(agent)) {
    return /Mobile/i.test(agent) ? "Android phone" : "Android tablet";
  }
  return null;
}

/** Parse a raw User-Agent into a platform label and optional device model. */
export function describeUserAgent(
  ua: string | null | undefined,
): ClientDescription {
  const agent = (ua || "").trim();
  if (!agent) return { platform: "Unknown", device: null };

  const os = detectOs(agent);
  const browser = detectBrowser(agent);
  const device = detectDevice(agent);

  const platform =
    browser && os ? `${browser} on ${os}` : browser || os || "Unknown";

  return { platform, device };
}
