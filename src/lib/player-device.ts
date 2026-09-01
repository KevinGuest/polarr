import { getOrCreateDeviceId } from "@/lib/device-id";
import { isPolarrDesktop } from "@/lib/desktop-shell";
import type { ConnectDeviceKind } from "@/lib/player-sync";

export type LocalConnectDevice = {
  id: string;
  name: string;
  kind: ConnectDeviceKind;
};

type TauriInvoke = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

function ua(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

export function detectConnectDevice(): LocalConnectDevice {
  const id = getOrCreateDeviceId() || "web";
  const agent = ua();

  if (typeof window !== "undefined" && isPolarrDesktop()) {
    return {
      id,
      name: /Macintosh|Mac OS X/i.test(agent) ? "This Mac" : "This Computer",
      kind: "computer",
    };
  }

  if (/iPhone/i.test(agent)) {
    return { id, name: "iPhone", kind: "phone" };
  }
  if (/iPad/i.test(agent)) {
    return { id, name: "iPad", kind: "tablet" };
  }
  if (/Android/i.test(agent) && /Mobile/i.test(agent)) {
    return { id, name: "Android", kind: "phone" };
  }
  if (/Android/i.test(agent)) {
    return { id, name: "Android tablet", kind: "tablet" };
  }
  if (/CrOS/i.test(agent)) {
    return { id, name: "Chromebook", kind: "computer" };
  }
  if (/Edg\//i.test(agent)) {
    return { id, name: "Web Player (Edge)", kind: "computer" };
  }
  if (/Chrome\//i.test(agent)) {
    return { id, name: "Web Player (Chrome)", kind: "computer" };
  }
  if (/Safari\//i.test(agent) && !/Chrome\//i.test(agent)) {
    return { id, name: "Web Player (Safari)", kind: "computer" };
  }
  if (/Firefox\//i.test(agent)) {
    return { id, name: "Web Player (Firefox)", kind: "computer" };
  }
  return { id, name: "Web Player", kind: "computer" };
}

export async function resolveConnectDevice(): Promise<LocalConnectDevice> {
  const device = detectConnectDevice();
  if (typeof window === "undefined" || !isPolarrDesktop()) return device;

  const w = window as Window & {
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  const invoke = w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== "function") return device;

  try {
    const name = await invoke("get_desktop_device_name");
    if (typeof name === "string" && name.trim()) {
      return { ...device, name: name.trim().slice(0, 80) };
    }
  } catch {
    /* fall back to the platform label */
  }
  return device;
}
