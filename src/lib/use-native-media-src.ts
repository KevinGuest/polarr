"use client";

import { useEffect, useState } from "react";
import { MEDIA_TICKET_UPDATED_EVENT } from "@/lib/ui-events";
import {
  isNativeClient,
  isNativeMediaPath,
  nativeAssetUrl,
  nativeSessionToken,
} from "@/lib/native-client";

const blobCache = new Map<string, string>();
const nativeDataUrlCache = new Map<string, string>();

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function desktopInvoke(): TauriInvoke | null {
  if (typeof window === "undefined" || window.__POLARR_NATIVE_CLIENT__?.platform !== "desktop") {
    return null;
  }
  const nativeWindow = window as Window & {
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  const owner = nativeWindow.__TAURI__?.core ?? nativeWindow.__TAURI_INTERNALS__;
  const invoke = owner?.invoke;
  return typeof invoke === "function" ? invoke.bind(owner) : null;
}

function cacheKeyFor(url: string) {
  try {
    const parsed = new URL(url, "https://native.local");
    parsed.searchParams.delete("mediaTicket");
    parsed.searchParams.delete("v");
    return parsed.toString();
  } catch {
    return url;
  }
}

function needsAuthFetch(url: string) {
  if (!isNativeClient()) return false;
  try {
    const path = url.startsWith("/")
      ? url.split("?")[0] || url
      : new URL(url).pathname;
    return isNativeMediaPath(path);
  } catch {
    return false;
  }
}

/**
 * Native WebViews cannot send Bearer tokens on CSS/img requests.
 * Fetch protected images with Authorization (CapacitorHttp) and expose a blob URL.
 */
export function useNativeMediaDisplaySrc(src: string | null | undefined): string | null {
  const stamped = nativeAssetUrl(src) || src || null;
  const key = stamped ? cacheKeyFor(stamped) : null;
  const [blobSrc, setBlobSrc] = useState<string | null>(() => {
    if (!stamped || !needsAuthFetch(stamped)) return null;
    return nativeDataUrlCache.get(cacheKeyFor(stamped)) || blobCache.get(cacheKeyFor(stamped)) || null;
  });
  const [epoch, setEpoch] = useState(0);
  const protectedSrc = Boolean(stamped && needsAuthFetch(stamped));

  useEffect(() => {
    const bump = () => setEpoch((n) => n + 1);
    window.addEventListener(MEDIA_TICKET_UPDATED_EVENT, bump);
    return () => window.removeEventListener(MEDIA_TICKET_UPDATED_EVENT, bump);
  }, []);

  useEffect(() => {
    if (!stamped || !needsAuthFetch(stamped)) {
      setBlobSrc(null);
      return;
    }

    const key = cacheKeyFor(stamped);
    const cached = nativeDataUrlCache.get(key) || blobCache.get(key);
    if (cached) {
      setBlobSrc(cached);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const token = nativeSessionToken();
        const url = nativeAssetUrl(src) || stamped;
        const invoke = token ? desktopInvoke() : null;
        if (invoke) {
          const parsed = new URL(url, window.location.origin);
          parsed.searchParams.delete("mediaTicket");
          parsed.searchParams.delete("v");
          if (parsed.pathname.startsWith("/api/")) {
            const dataUrl = await invoke<string | null>("desktop_media_data_url", {
              path: `${parsed.pathname}${parsed.search}`,
              token,
            });
            if (dataUrl) {
              nativeDataUrlCache.set(key, dataUrl);
              if (!cancelled) setBlobSrc(dataUrl);
              return;
            }
          }
        }
        const headers = new Headers();
        if (token) headers.set("Authorization", `Bearer ${token}`);
        // Patched native fetch routes same-server image GETs through CapacitorHttp.
        // Never reuse a prior 401/empty cache entry for avatars.
        const response = await fetch(url, { headers, cache: "no-store" });
        if (!response.ok) return;
        const blob = await response.blob();
        if (blob.size < 32) return;
        if (blob.type && !blob.type.startsWith("image/") && !blob.type.includes("octet-stream")) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        blobCache.set(key, objectUrl);
        if (!cancelled) setBlobSrc(objectUrl);
      } catch {
        /* Keep prior blob if any; letter fallback otherwise. */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, stamped, key, epoch]);

  // Desktop loads the UI from the Tauri origin — ticketed <img> URLs are
  // cross-origin and 401 without cookies. Wait for the native data URL / blob.
  // iOS can paint the ticketed URL immediately while the blob warms.
  if (protectedSrc) {
    if (typeof window !== "undefined" && window.__POLARR_NATIVE_CLIENT__?.platform === "desktop") {
      return blobSrc;
    }
    return blobSrc || stamped;
  }
  return blobSrc || stamped;
}
