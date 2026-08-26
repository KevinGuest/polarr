"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Activity,
  Clock,
  LogOut,
  Megaphone,
  Settings,
  Shield,
  User,
} from "lucide-react";
import { BanStatusBox } from "@/components/ban-status-box";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { AVATAR_UPDATED_EVENT } from "@/lib/ui-events";
import { cn } from "@/lib/utils";

type AuthUser = {
  publicId?: string;
  username: string;
  isAdmin: boolean;
  role?: string;
  avatarUrl?: string | null;
};

function useAuthUser() {
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

  const avatarSrc = user?.avatarUrl
    ? `${user.avatarUrl}${user.avatarUrl.includes("?") ? "&" : "?"}v=${avatarVer || 1}`
    : null;

  const isStaff =
    Boolean(user?.isAdmin) ||
    user?.role === "owner" ||
    user?.role === "admin" ||
    user?.role === "moderator";

  return { user, avatarSrc, isStaff, refresh };
}

export function UserMenu({
  variant = "icon",
}: {
  /** icon = circle only; sidebar = avatar + username row for admin footer */
  variant?: "icon" | "sidebar";
}) {
  const router = useRouter();
  const { user, avatarSrc, isStaff } = useAuthUser();

  async function logout() {
    await fetch("/api/auth/me", { method: "DELETE" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

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
        {isStaff && (
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

function DrawerRow({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof Settings;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-muted/40"
    >
      <Icon className="size-6 shrink-0 text-foreground" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold text-foreground">
          {label}
        </span>
        {hint ? (
          <span className="mt-0.5 block text-sm text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Mobile account side menu — slides in from the same side as the avatar.
 * Home: avatar left → drawer left. Other screens: avatar right → drawer right.
 */
export function ProfileDrawer({
  side = "left",
  className,
}: {
  side?: "left" | "right";
  className?: string;
}) {
  const router = useRouter();
  const { user, avatarSrc, isStaff } = useAuthUser();
  const [open, setOpen] = useState(false);

  async function logout() {
    setOpen(false);
    await fetch("/api/auth/me", { method: "DELETE" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const fromLeft = side === "left";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted/40 text-xs font-semibold uppercase leading-none hover:border-foreground/40",
          className,
        )}
        aria-label={
          user ? `Account menu for ${user.username}` : "Account menu"
        }
      >
        <UserAvatar
          username={user?.username || "?"}
          avatarUrl={avatarSrc}
          textClassName="text-sm font-semibold"
        />
      </button>

      <DialogPortal>
        <DialogOverlay className="z-[70] bg-black/55 lg:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-y-0 z-[70] flex w-[min(22rem,88vw)] flex-col bg-background text-foreground shadow-2xl outline-none lg:hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "duration-300",
            fromLeft
              ? "left-0 border-r border-border data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
              : "right-0 border-l border-border data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">
            Account menu
          </DialogPrimitive.Title>

          <div className="min-h-0 flex-1 overflow-y-auto pt-[max(1rem,var(--safe-top))]">
            <button
              type="button"
              onClick={() => go("/profile")}
              className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
            >
              <span className="relative size-12 shrink-0 overflow-hidden rounded-full border border-border">
                <UserAvatar
                  username={user?.username || "?"}
                  avatarUrl={avatarSrc}
                  textClassName="text-base font-semibold"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold text-foreground">
                  {user?.username || "Account"}
                </span>
                <span className="block text-sm text-muted-foreground">
                  View profile
                </span>
              </span>
            </button>

            <div className="mt-1 border-t border-border/60 pt-1">
              <DrawerRow
                icon={Settings}
                label="Settings and privacy"
                onClick={() => go("/settings")}
              />
              <DrawerRow
                icon={Clock}
                label="Recents"
                onClick={() => go("/recent")}
              />
              <DrawerRow
                icon={Megaphone}
                label="Your Updates"
                onClick={() => go("/notifications")}
              />
              <DrawerRow
                icon={Activity}
                label="Listening stats"
                onClick={() => go("/profile/top-tracks")}
              />
              {isStaff ? (
                <DrawerRow
                  icon={Shield}
                  label="Admin"
                  onClick={() => go("/admin")}
                />
              ) : null}
              <DrawerRow
                icon={LogOut}
                label="Log out"
                onClick={() => void logout()}
              />
            </div>
          </div>

          <div className="shrink-0 px-4 pb-[max(0.75rem,var(--safe-bottom))] pt-1">
            <BanStatusBox />
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
