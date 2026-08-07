/** Client device id used as HWID for optional bans (not a real NIC MAC). */

const STORAGE_KEY = "polarr_hwid";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `hw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Stable browser device id (localStorage). Safe for login/join reporting. */
export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY)?.trim();
    if (existing && existing.length >= 8 && existing.length <= 128) {
      return existing;
    }
    const id = newId();
    window.localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return "";
  }
}
