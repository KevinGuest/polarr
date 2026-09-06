"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AVATAR_UPDATED_EVENT, MEDIA_TICKET_UPDATED_EVENT } from "@/lib/ui-events";
import type { UserRole } from "@/lib/roles";
import { roleIsStaff } from "@/lib/roles";
import {
  clearDesktopOfflineSession,
  setDesktopOfflineSession,
  startDesktopOfflineSync,
} from "@/lib/desktop-offline";
import { clearNativeSessionToken, nativeAssetUrl, nativeSessionToken } from "@/lib/native-client";

export type BanStatus = {
  stream: boolean;
  download: boolean;
  user: boolean;
  expiresAt: string | null;
  permanent: boolean;
  label: string;
  rickroll?: boolean;
} | null;

export type AuthUser = {
  publicId?: string;
  username: string;
  isAdmin: boolean;
  role?: string;
  avatarUrl?: string | null;
  bannerColors?: string[] | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  ban: BanStatus;
  role: UserRole | null;
  avatarSrc: string | null;
  isStaff: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  clear: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function roleFromUser(user: AuthUser | null): UserRole | null {
  if (!user) return null;
  const r = user.role;
  if (r === "owner" || r === "admin" || r === "moderator" || r === "member") {
    return r;
  }
  if (user.isAdmin) return "admin";
  return "member";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ban, setBan] = useState<BanStatus>(null);
  const [avatarVer, setAvatarVer] = useState(0);
  const [ticketRev, setTicketRev] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // Identity data must not be served from the native stale-first cache.
      // In particular, avatar uploads need to replace a previously cached
      // `avatarUrl: null` as soon as the app reconnects.
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = res.ok ? await res.json() : { user: null, ban: null };
      const nextUser = (data.user ?? null) as AuthUser | null;
      setUser((prev) => {
        const prevAvatar = prev?.avatarUrl || null;
        const nextAvatar = nextUser?.avatarUrl || null;
        // Only bust avatar cache when the asset itself changes — not on every /me poll.
        if (nextAvatar && nextAvatar !== prevAvatar) {
          queueMicrotask(() => setAvatarVer(Date.now()));
        }
        return nextUser;
      });
      setBan(data.ban ?? null);
    } catch {
      // Keep session UI if we still have a native token (offline / flaky network).
      if (!nativeSessionToken()) {
        setUser(null);
        setBan(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setUser(null);
    setBan(null);
    setLoading(false);
    void clearDesktopOfflineSession();
    clearNativeSessionToken();
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const uid = user?.publicId ?? null;
    void setDesktopOfflineSession(uid);
  }, [user?.publicId]);

  useEffect(() => {
    return startDesktopOfflineSync(() => user?.publicId ?? null);
  }, [user?.publicId]);

  useEffect(() => {
    function onAvatarUpdated() {
      void refresh();
    }
    function onMediaTicket() {
      // Re-read nativeAssetUrl on next render without changing `v=` (img remount).
      setTicketRev((n) => n + 1);
    }
    window.addEventListener(AVATAR_UPDATED_EVENT, onAvatarUpdated);
    window.addEventListener(MEDIA_TICKET_UPDATED_EVENT, onMediaTicket);
    return () => {
      window.removeEventListener(AVATAR_UPDATED_EVENT, onAvatarUpdated);
      window.removeEventListener(MEDIA_TICKET_UPDATED_EVENT, onMediaTicket);
    };
  }, [refresh]);

  const role = roleFromUser(user);
  const avatarSrc = (() => {
    void ticketRev;
    if (!user?.avatarUrl) return null;
    const resolved = nativeAssetUrl(user.avatarUrl) || user.avatarUrl;
    const sep = resolved.includes("?") ? "&" : "?";
    return `${resolved}${sep}v=${avatarVer || 1}`;
  })();
  const isStaff = roleIsStaff(role) || Boolean(user?.isAdmin);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ban,
      role,
      avatarSrc,
      isStaff,
      loading,
      refresh,
      clear,
    }),
    [user, ban, role, avatarSrc, isStaff, loading, refresh, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

/** Safe for components that may render outside the shell (returns nulls). */
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext);
}
