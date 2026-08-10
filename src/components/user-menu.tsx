"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Settings, Shield, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { AVATAR_UPDATED_EVENT } from "@/lib/ui-events";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";

type AuthUser = {
  publicId?: string;
  username: string;
  isAdmin: boolean;
  role?: string;
  avatarUrl?: string | null;
};

export function UserMenu({
  variant = "icon",
}: {
  /** icon = circle only; sidebar = avatar + username row for admin footer */
  variant?: "icon" | "sidebar";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [avatarVer, setAvatarVer] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = res.ok ? await res.json() : { user: null };
      setUser(data.user ?? null);
      if (data.user?.avatarUrl) setAvatarVer(Date.now());
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    function onAvatarUpdated() {
      void refresh();
    }
    window.addEventListener(AVATAR_UPDATED_EVENT, onAvatarUpdated);
    return () => {
      window.removeEventListener(AVATAR_UPDATED_EVENT, onAvatarUpdated);
    };
  }, [refresh]);

  async function logout() {
    await fetch("/api/auth/me", { method: "DELETE" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

  const avatarSrc = user?.avatarUrl
    ? `${user.avatarUrl}${user.avatarUrl.includes("?") ? "&" : "?"}v=${avatarVer || 1}`
    : null;

  const avatar = (
    <span className="relative size-8 shrink-0 overflow-hidden rounded-full border border-border text-xs">
      <UserAvatar
        username={user?.username || "?"}
        avatarUrl={avatarSrc}
        textClassName="text-xs font-medium translate-y-px"
      />
    </span>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            variant === "sidebar"
              ? "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
              : "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border text-xs font-medium uppercase leading-none hover:border-foreground/40 hover:bg-muted",
          )}
          aria-label={
            user ? `Account menu for ${user.username}` : "Account menu"
          }
        >
          {variant === "sidebar" ? (
            <>
              {avatar}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {user?.username || "Account"}
              </span>
            </>
          ) : (
            <UserAvatar
              username={user?.username || "?"}
              avatarUrl={avatarSrc}
              textClassName="text-xs font-medium translate-y-px"
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === "sidebar" ? "start" : "end"}
        side={variant === "sidebar" ? "top" : "bottom"}
        className="w-48"
      >
        {user && (
          <>
            <DropdownMenuLabel className="normal-case tracking-normal">
              {user.username}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          className="gap-2"
          onSelect={() => router.push("/profile")}
        >
          <User className="size-3.5 shrink-0 text-muted-foreground" />
          Profile
        </DropdownMenuItem>
        {(user?.isAdmin ||
          user?.role === "owner" ||
          user?.role === "admin" ||
          user?.role === "moderator") && (
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => router.push("/admin")}
          >
            <Shield className="size-3.5 shrink-0 text-muted-foreground" />
            Admin
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="gap-2"
          onSelect={() => router.push("/settings")}
        >
          <Settings className="size-3.5 shrink-0 text-muted-foreground" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          onSelect={(e) => {
            e.preventDefault();
            void logout();
          }}
        >
          <LogOut className="size-3.5 shrink-0" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
