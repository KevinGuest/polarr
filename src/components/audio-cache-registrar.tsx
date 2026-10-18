"use client";

import { useEffect } from "react";
import { registerAudioCacheWorker } from "@/lib/audio-cache";

/** Registers the recent-tracks audio cache worker once the app is interactive. */
export function AudioCacheRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const id = window.setTimeout(() => {
      void registerAudioCacheWorker();
    }, 1_500);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
