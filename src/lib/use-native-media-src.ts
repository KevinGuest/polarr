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
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);

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
    const cached = blobCache.get(key);
    if (cached) {
      setBlobSrc(cached);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const token = nativeSessionToken();
        const url = nativeAssetUrl(src) || stamped;
        const headers = new Headers();
        if (token) headers.set("Authorization", `Bearer ${token}`);
        // Patched native fetch routes same-server image GETs through CapacitorHttp.
        const response = await fetch(url, { headers, cache: "force-cache" });
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
        /* Fall back to stamped URL (mediaTicket) when available. */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, stamped, epoch]);

  return blobSrc || stamped;
}
