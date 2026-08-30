import { getOrCreateDeviceId } from "@/lib/device-id";
import { isPolarrDesktop } from "@/lib/desktop-shell";
import type { ConnectDeviceKind } from "@/lib/player-sync";

export type LocalConnectDevice = {
  id: string;
  name: string;
  kind: ConnectDeviceKind;
};

function ua(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

export function detectConnectDevice(): LocalConnectDevice {
  const id = getOrCreateDeviceId() || "web";
  const agent = ua();

  if (typeof window !== "undefined" && isPolarrDesktop()) {
    const platform = /Macintosh|Mac OS X/i.test(agent)
      ? "macOS"
      : /Windows/i.test(agent)
        ? "Windows"
        : /Linux/i.test(agent)
          ? "Linux"
          : "Desktop";
    return { id, name: `Polarr for ${platform}`, kind: "computer" };
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
  if (/Macintosh|Mac OS X/i.test(agent)) {
    return { id, name: "This Mac", kind: "computer" };
  }
  if (/Windows/i.test(agent)) {
    return { id, name: "This computer", kind: "computer" };
  }
  if (/CrOS/i.test(agent)) {
    return { id, name: "Chromebook", kind: "computer" };
  }
  if (/Linux/i.test(agent)) {
    return { id, name: "This computer", kind: "computer" };
  }
  return { id, name: "This web browser", kind: "computer" };
}

export function selfDeviceLabel(device: LocalConnectDevice): string {
  if (device.kind === "phone") {
    return device.name.startsWith("This ") ? device.name : `This ${device.name}`;
  }
  if (device.name.startsWith("Polarr for ")) return `This ${device.name}`;
  if (device.name.startsWith("This ")) return device.name;
  return `This ${device.name}`;
}
