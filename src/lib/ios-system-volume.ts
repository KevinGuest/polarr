/**
 * iOS system output volume via native MPVolumeView bridge.
 * Element.volume alone does not match Control Center / hardware buttons.
 */

import { nativeClientPlatform } from "@/lib/native-client";

type VolumePlugin = {
  getVolume(): Promise<{ volume?: number }>;
  setVolume(options: { volume: number }): Promise<{ volume?: number }>;
  addListener?(
    event: "volumeChange",
    handler: (data: { volume?: number }) => void,
  ): Promise<{ remove: () => void }> | { remove: () => void };
};

function getVolumePlugin(): VolumePlugin | null {
  if (typeof window === "undefined") return null;
  if (nativeClientPlatform() !== "ios") return null;
  const cap = window as Window & {
    Capacitor?: { Plugins?: { PolarrVolume?: VolumePlugin } };
  };
  return cap.Capacitor?.Plugins?.PolarrVolume || null;
}

export function usesSystemVolume(): boolean {
  return Boolean(getVolumePlugin());
}

export async function readSystemVolume(): Promise<number | null> {
  const plugin = getVolumePlugin();
  if (!plugin) return null;
  try {
    const result = await plugin.getVolume();
    const v = Number(result?.volume);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
  } catch {
    return null;
  }
}

export async function writeSystemVolume(volume: number): Promise<boolean> {
  const plugin = getVolumePlugin();
  if (!plugin) return false;
  try {
    await plugin.setVolume({ volume: Math.max(0, Math.min(1, volume)) });
    return true;
  } catch {
    return false;
  }
}

export function subscribeSystemVolume(
  onChange: (volume: number) => void,
): () => void {
  const plugin = getVolumePlugin();
  if (!plugin?.addListener) return () => {};
  let removed = false;
  let handle: { remove: () => void } | null = null;
  void Promise.resolve(
    plugin.addListener("volumeChange", (data) => {
      const v = Number(data?.volume);
      if (Number.isFinite(v)) onChange(Math.max(0, Math.min(1, v)));
    }),
  ).then((h) => {
    if (removed) {
      try {
        h.remove();
      } catch {
        /* ignore */
      }
      return;
    }
    handle = h;
  });
  return () => {
    removed = true;
    try {
      handle?.remove();
    } catch {
      /* ignore */
    }
  };
}
