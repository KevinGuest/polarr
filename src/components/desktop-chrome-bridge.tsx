"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuthOptional } from "@/components/auth-provider";
import { OPEN_PROFILE_DRAWER_EVENT } from "@/components/user-menu";
import {
  absolutizeUrl,
  captureDesktopQueryParam,
  hasPolarrDesktopGlobal,
  isPolarrDesktop,
  listenChromeFromShell,
  markPolarrDesktop,
  postChromeToShell,
} from "@/lib/desktop-shell";

async function avatarDataUrlFromSrc(
  src: string | null | undefined,
): Promise<string | null> {
  if (!src) return null;
  try {
    const res = await fetch(src, { credentials: "include", cache: "no-store" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Syncs auth + navigation with the Tauri title bar.
 * Works with child webview (Tauri invoke/events) and legacy iframe (postMessage).
 */
export function DesktopChromeBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const auth = useAuthOptional();
  const unreadRef = useRef(0);

  // Mark desktop on mount + every SPA navigation.
  useEffect(() => {
    const fromQuery = captureDesktopQueryParam();
    if (fromQuery || isPolarrDesktop() || hasPolarrDesktopGlobal()) {
      markPolarrDesktop();
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    captureDesktopQueryParam();
    if (isPolarrDesktop() || hasPolarrDesktopGlobal()) {
      markPolarrDesktop();
    }

    const stop = listenChromeFromShell((data) => {
      if (data.type === "hello" || data.type === "ping") {
        markPolarrDesktop();
        if (data.type === "ping" && data.id) {
          postChromeToShell({ type: "pong", id: data.id });
        }
      }
    });

    postChromeToShell({ type: "ready" });

    // Keep markers alive through React hydration races.
    const timers = [0, 50, 200, 800, 2000].map((ms) =>
      window.setTimeout(() => {
        if (isPolarrDesktop() || hasPolarrDesktopGlobal()) markPolarrDesktop();
      }, ms),
    );

    return () => {
      stop();
      for (const id of timers) window.clearTimeout(id);
    };
  }, []);

  // Poll unread count lightly for the title-bar badge.
  useEffect(() => {
    if (!isPolarrDesktop() && !hasPolarrDesktopGlobal()) return;
    if (!auth?.user || auth.loading) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { unread?: number };
        const next = Number(data.unread) || 0;
        if (next === unreadRef.current) return;
        unreadRef.current = next;
        const avatarUrl = absolutizeUrl(auth.avatarSrc, window.location.origin);
        const avatarDataUrl = await avatarDataUrlFromSrc(avatarUrl);
        if (cancelled) return;
        postChromeToShell({
          type: "auth",
          payload: {
            authenticated: true,
            username: auth.user?.username ?? null,
            avatarUrl,
            avatarDataUrl,
            isStaff: Boolean(auth.isStaff),
            pathname,
            searchQuery:
              pathname === "/search" ? searchParams.get("q") || "" : null,
            notificationUnread: next,
          },
        });
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(tick, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    auth?.avatarSrc,
    auth?.isStaff,
    auth?.loading,
    auth?.user,
    pathname,
    searchParams,
  ]);

  // Push auth state whenever it changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Always push when desktop markers exist OR we're in a Tauri child webview
    // (__POLARR_DESKTOP__ / session). Do not require parent≠window (child webview).
    if (!isPolarrDesktop() && !hasPolarrDesktopGlobal()) {
      // Still try once if ?desktop= was captured this tick.
      if (!captureDesktopQueryParam()) return;
    }

    markPolarrDesktop();

    const searchQuery =
      pathname === "/search" ? searchParams.get("q") || "" : null;

    if (!auth) {
      postChromeToShell({
        type: "auth",
        payload: {
          authenticated: false,
          pathname,
          searchQuery,
          notificationUnread: 0,
        },
      });
      return;
    }

    // Avoid collapsing chrome while /api/auth/me is in flight.
    if (auth.loading) return;

    const origin = window.location.origin;
    const avatarUrl = absolutizeUrl(auth.avatarSrc, origin);

    let cancelled = false;
    void (async () => {
      const avatarDataUrl = auth.user
        ? await avatarDataUrlFromSrc(avatarUrl)
        : null;
      if (cancelled) return;
      postChromeToShell({
        type: "auth",
        payload: {
          authenticated: Boolean(auth.user),
          username: auth.user?.username ?? null,
          avatarUrl,
          avatarDataUrl,
          isStaff: Boolean(auth.isStaff),
          pathname,
          searchQuery,
          notificationUnread: unreadRef.current,
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    auth,
    auth?.avatarSrc,
    auth?.isStaff,
    auth?.loading,
    auth?.user,
    pathname,
    searchParams,
  ]);

  // Handle commands from the title bar.
  useEffect(() => {
    const stop = listenChromeFromShell((data) => {
      const ack = (id?: string) => {
        if (!id) return;
        postChromeToShell({ type: "ack", id, ok: true });
      };

      if (data.type === "hello" || data.type === "ping") {
        markPolarrDesktop();
        return;
      }

      if (data.type === "navigate" && typeof data.path === "string") {
        const path = data.path.startsWith("/") ? data.path : `/${data.path}`;
        router.push(path);
        ack(data.id);
        return;
      }

      if (data.type === "open-notifications") {
        router.push("/notifications");
        ack(data.id);
        return;
      }

      if (data.type === "open-profile") {
        router.push("/profile");
        ack(data.id);
        return;
      }

      if (data.type === "open-profile-drawer") {
        window.dispatchEvent(new Event(OPEN_PROFILE_DRAWER_EVENT));
        ack(data.id);
        return;
      }

      if (data.type === "search") {
        const q = (data.q ?? "").trim();
        const href = q ? `/search?q=${encodeURIComponent(q)}` : "/search";
        router.replace(href);
        ack(data.id);
        return;
      }

      if (data.type === "logout") {
        void (async () => {
          await fetch("/api/auth/me", { method: "DELETE" }).catch(() => null);
          auth?.clear();
          router.replace("/login");
          router.refresh();
          ack(data.id);
        })();
      }
    });

    return stop;
  }, [auth, router]);

  return null;
}
