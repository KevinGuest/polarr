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
import { AVATAR_UPDATED_EVENT } from "@/lib/ui-events";
import type { UserRole } from "@/lib/roles";
import { roleIsStaff } from "@/lib/roles";
import {
  clearDesktopOfflineSession,
  setDesktopOfflineSession,
  startDesktopOfflineSync,
} from "@/lib/desktop-offline";

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
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = res.ok ? await res.json() : { user: null, ban: null };
      setUser(data.user ?? null);
      setBan(data.ban ?? null);
      if (data.user?.avatarUrl) setAvatarVer(Date.now());
    } catch {
      setUser(null);
      setBan(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setUser(null);
    setBan(null);
    setLoading(false);
    void clearDesktopOfflineSession();
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
    window.addEventListener(AVATAR_UPDATED_EVENT, onAvatarUpdated);
    return () => {
      window.removeEventListener(AVATAR_UPDATED_EVENT, onAvatarUpdated);
    };
  }, [refresh]);

  const role = roleFromUser(user);
  const avatarSrc = user?.avatarUrl
    ? `${user.avatarUrl}${user.avatarUrl.includes("?") ? "&" : "?"}v=${avatarVer || 1}`
    : null;
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
