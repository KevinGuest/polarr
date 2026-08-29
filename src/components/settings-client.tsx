"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AUTH_CONTROL, AUTH_SUBMIT, AuthFieldGroup } from "@/components/auth-screen";
import { InsetGroup } from "@/components/media-shelf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  isPasswordLongEnough,
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_SHORT_MSG,
} from "@/lib/auth-password";
import { invalidateDiscordPresenceCache } from "@/components/player-provider";
import { toastError, toastSaved, toastSuccess } from "@/lib/toast";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SettingsTab = "profile" | "playlists" | "discord";

type ImportSummary = {
  playlistId: string;
  name: string;
  matched: number;
  unresolved: number;
  total: number;
};

type ServiceId = "spotify" | "youtube" | "deezer" | "apple";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "playlists", label: "Playlists" },
  { id: "discord", label: "Discord" },
];

const SERVICES: {
  id: ServiceId;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  {
    id: "spotify",
    label: "Spotify",
    hint: "Paste a public playlist link",
    placeholder: "https://open.spotify.com/playlist/…",
  },
  {
    id: "youtube",
    label: "YouTube Music",
    hint: "Playlist or mix link",
    placeholder: "https://music.youtube.com/playlist?list=…",
  },
  {
    id: "deezer",
    label: "Deezer",
    hint: "Works with no extra setup",
    placeholder: "https://www.deezer.com/playlist/…",
  },
  {
    id: "apple",
    label: "Apple Music",
    hint: "Coming soon",
    placeholder: "https://music.apple.com/…/playlist/…",
  },
];

export function SettingsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: SettingsTab =
    tabParam === "playlists" || tabParam === "discord" ? tabParam : "profile";

  const [loading, setLoading] = useState(true);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [service, setService] = useState<ServiceId>("spotify");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [serviceReady, setServiceReady] = useState<Record<string, boolean>>({
    spotify: false,
    youtube: true,
    deezer: true,
    apple: false,
  });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);

  const [discordLinked, setDiscordLinked] = useState(false);
  const [discordUsername, setDiscordUsername] = useState<string | null>(null);
  const [discordDisplayName, setDiscordDisplayName] = useState<string | null>(
    null,
  );
  const [discordAvatarUrl, setDiscordAvatarUrl] = useState<string | null>(null);
  const [discordLoginEnabled, setDiscordLoginEnabled] = useState(true);
  const [discordPresence, setDiscordPresence] = useState(false);
  const [discordOAuthReady, setDiscordOAuthReady] = useState(false);
  const [discordPresenceReady, setDiscordPresenceReady] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);

  function applyDiscordAccount(data: {
    discord?: {
      linked?: boolean;
      username?: string | null;
      displayName?: string | null;
      avatarUrl?: string | null;
      presenceEnabled?: boolean;
      loginEnabled?: boolean;
    };
    discordOAuthReady?: boolean;
    discordPresenceReady?: boolean;
    discordClientId?: string | null;
  }) {
    const linked = Boolean(data.discord?.linked);
    setDiscordLinked(linked);
    setDiscordUsername(
      typeof data.discord?.username === "string" ? data.discord.username : null,
    );
    setDiscordDisplayName(
      typeof data.discord?.displayName === "string"
        ? data.discord.displayName
        : typeof data.discord?.username === "string"
          ? data.discord.username
          : null,
    );
    setDiscordAvatarUrl(
      typeof data.discord?.avatarUrl === "string"
        ? data.discord.avatarUrl
        : null,
    );
    setDiscordLoginEnabled(
      data.discord?.loginEnabled == null
        ? true
        : Boolean(data.discord.loginEnabled),
    );
    setDiscordPresence(Boolean(data.discord?.presenceEnabled));
    setDiscordOAuthReady(Boolean(data.discordOAuthReady));
    setDiscordPresenceReady(
      Boolean(data.discordPresenceReady || data.discordClientId),
    );
  }

  function setTab(next: SettingsTab) {
    router.replace(`/settings?tab=${next}`, { scroll: false });
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [accountRes, servicesRes] = await Promise.all([
        fetch("/api/account", { cache: "no-store" }),
        fetch("/api/playlists/import", { cache: "no-store" }),
      ]);
      if (cancelled) return;
      if (accountRes.status === 401) {
        router.replace("/login");
        return;
      }
      if (accountRes.ok) {
        const data = await accountRes.json();
        setUsername(typeof data.username === "string" ? data.username : "");
        setEmail(typeof data.email === "string" ? data.email : "");
        applyDiscordAccount(data);
      }
      if (servicesRes.ok) {
        const data = await servicesRes.json();
        if (data.services) setServiceReady(data.services);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const flag = searchParams.get("discord");
    if (!flag) return;
    const messages: Record<string, string> = {
      linked: "Discord linked",
      denied: "Discord authorization was cancelled",
      missing: "Discord callback was missing data",
      auth: "Sign in again, then link Discord",
      config: "Discord app isn’t configured on this server",
      state: "Discord link expired — try again",
      token: "Couldn’t finish Discord login",
      user: "Couldn’t read your Discord profile",
    };
    const text = messages[flag];
    if (flag === "linked") {
      toastSuccess(text || "Discord linked");
      setTab("discord");
      void fetch("/api/account")
        .then((r) => r.json())
        .then((data) => {
          applyDiscordAccount(data);
        })
        .catch(() => null);
    } else if (text) {
      toastError(text);
    }
    router.replace("/settings?tab=discord", { scroll: false });
  }, [searchParams, router]);

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string" ? data.error : "Could not save",
        );
        return;
      }
      setUsername(data.username || username);
      setEmail(data.email || email);
      toastSaved();
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword() {
    setSavingPassword(true);
    try {
      if (!currentPassword) {
        toastError("Current password is required");
        return;
      }
      if (!isPasswordLongEnough(newPassword)) {
        toastError(PASSWORD_TOO_SHORT_MSG);
        return;
      }
      if (newPassword !== confirmPassword) {
        toastError("New passwords do not match");
        return;
      }
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string"
            ? data.error
            : "Could not update password",
        );
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toastSaved("Password updated");
    } finally {
      setSavingPassword(false);
    }
  }

  async function runImport() {
    const url = playlistUrl.trim();
    if (!url) {
      toastError("Paste a playlist link from the service you picked.");
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/playlists/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service,
          url,
          name: playlistName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string" ? data.error : "Import failed",
        );
        return;
      }
      setImportResult({
        playlistId: data.playlistId,
        name: data.name,
        matched: data.matched,
        unresolved: data.unresolved,
        total: data.total,
      });
      setPlaylistUrl("");
      toastSuccess(
        `Imported “${data.name || "playlist"}”`,
        `${data.matched ?? 0}/${data.total ?? 0} matched`,
      );
    } finally {
      setImporting(false);
    }
  }

  async function linkDiscord() {
    setDiscordBusy(true);
    try {
      const res = await fetch("/api/discord/oauth");
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        toastError(
          typeof data.error === "string"
            ? data.error
            : "Could not start Discord link",
        );
        return;
      }
      window.location.href = data.url as string;
    } finally {
      setDiscordBusy(false);
    }
  }

  async function unlinkDiscord() {
    setDiscordBusy(true);
    try {
      const res = await fetch("/api/discord/oauth", { method: "DELETE" });
      if (!res.ok) {
        toastError("Could not unlink Discord");
        return;
      }
      setDiscordLinked(false);
      setDiscordUsername(null);
      setDiscordDisplayName(null);
      setDiscordAvatarUrl(null);
      setDiscordLoginEnabled(true);
      setDiscordPresence(false);
      invalidateDiscordPresenceCache();
      toastSuccess("Discord unlinked");
    } finally {
      setDiscordBusy(false);
    }
  }

  async function setDiscordLogin(enabled: boolean) {
    setDiscordBusy(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordLoginEnabled: enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string"
            ? data.error
            : "Could not update Discord login",
        );
        return;
      }
      applyDiscordAccount(data);
      toastSaved(
        enabled
          ? "Discord login enabled"
          : "Discord login disabled",
      );
    } finally {
      setDiscordBusy(false);
    }
  }

  async function togglePresence(enabled: boolean) {
    if (enabled && !discordLinked) {
      toastError("Link your Discord account first");
      return;
    }
    setDiscordPresence(enabled);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discordPresenceEnabled: enabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDiscordPresence(!enabled);
      toastError(
        typeof data.error === "string"
          ? data.error
          : "Could not update presence",
      );
      return;
    }
    invalidateDiscordPresenceCache();

    if (!enabled) {
      toastSaved("Listening status off");
      return;
    }

    const { isDesktopDiscordRpcAvailable, probeDiscordPresence } =
      await import("@/lib/discord-rpc");
    if (!isDesktopDiscordRpcAvailable()) {
      toastSaved("Listening status on");
      toastError(
        "Rich Presence only shows in the Polarr desktop app with Discord open — browser tabs cannot set it.",
      );
      return;
    }

    let appId =
      typeof data.discordClientId === "string"
        ? data.discordClientId.trim()
        : "";
    if (!appId) {
      const acct = await fetch("/api/account", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({}));
      appId =
        typeof acct.discordClientId === "string"
          ? acct.discordClientId.trim()
          : "";
    }
    if (!appId) {
      toastSaved("Listening status on");
      return;
    }

    const probe = await probeDiscordPresence(appId);
    if (!probe.ok) {
      toastError(probe.error);
    } else {
      toastSaved("Listening status on — Discord connected");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <h1 className="text-[2rem] font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const active = SERVICES.find((s) => s.id === service)!;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-[2rem] font-semibold tracking-tight">Settings</h1>
          <p className="text-[15px] text-muted-foreground">
            Profile, playlists, and Discord.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-foreground text-background"
                  : "bg-muted/60 text-foreground hover:bg-muted",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "profile" ? (
        <>
          <section className="space-y-3">
            <h2 className="text-[1.375rem] font-semibold tracking-tight">
              Profile
            </h2>
            <p className="text-[15px] text-muted-foreground">
              Username and email for this account.
            </p>
            <AuthFieldGroup>
              <Input
                id="account-username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={40}
                placeholder="Username"
                className={AUTH_CONTROL}
              />
              <Input
                id="account-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className={AUTH_CONTROL}
              />
            </AuthFieldGroup>
            <Button
              type="button"
              className={AUTH_SUBMIT}
              disabled={savingProfile || !username.trim() || !email.trim()}
              onClick={() => void saveProfile()}
            >
              {savingProfile ? "Saving…" : "Save profile"}
            </Button>
          </section>

          <section className="space-y-3">
            <h2 className="text-[1.375rem] font-semibold tracking-tight">
              Password
            </h2>
            <p className="text-[15px] text-muted-foreground">
              Change the password you sign in with.
            </p>
            <AuthFieldGroup>
              <PasswordInput
                id="current-password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                className={AUTH_CONTROL}
              />
              <PasswordInput
                id="new-password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className={AUTH_CONTROL}
              />
              <PasswordInput
                id="confirm-password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className={AUTH_CONTROL}
              />
            </AuthFieldGroup>
            <p className="text-[13px] text-muted-foreground">
              At least {MIN_PASSWORD_LENGTH} characters
            </p>
            <Button
              type="button"
              className={cn(AUTH_SUBMIT, "mt-2")}
              disabled={
                savingPassword ||
                !currentPassword ||
                newPassword.length < MIN_PASSWORD_LENGTH ||
                !confirmPassword
              }
              onClick={() => void savePassword()}
            >
              {savingPassword ? "Updating…" : "Update password"}
            </Button>
          </section>
        </>
      ) : null}

      {tab === "playlists" ? (
        <section className="space-y-3">
          <h2 className="text-[1.375rem] font-semibold tracking-tight">
            Import playlist
          </h2>
          <p className="text-[15px] text-muted-foreground">
            Pull a playlist from Spotify, YouTube Music, or Deezer with a link.
          </p>
          {importResult ? (
            <InsetGroup>
              <div className="space-y-1 px-4 py-3.5 text-[15px]">
                <p className="font-medium text-foreground">
                  Created “{importResult.name}”
                </p>
                <p className="text-muted-foreground">
                  {importResult.matched} of {importResult.total} tracks added
                  {importResult.unresolved > 0
                    ? ` · ${importResult.unresolved} unmatched`
                    : ""}
                  .
                </p>
              </div>
            </InsetGroup>
          ) : null}
          <Button
            type="button"
            className={AUTH_SUBMIT}
            onClick={() => setImportOpen(true)}
          >
            Import playlist
          </Button>
        </section>
      ) : null}

      {tab === "discord" ? (
        <section className="space-y-3">
          <h2 className="text-[1.375rem] font-semibold tracking-tight">
            Discord
          </h2>
          <p className="text-[15px] text-muted-foreground">
            Link Discord to sign in and show your listening status.
          </p>
          {!discordOAuthReady ? (
            <p className="text-[15px] text-muted-foreground">
              An admin hasn’t finished Discord setup yet (Admin →
              Notifications).
            </p>
          ) : discordLinked ? (
            <InsetGroup>
              <div className="flex min-h-14 items-center gap-3 px-3">
                <div className="relative size-10 shrink-0 overflow-hidden rounded-full bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      discordAvatarUrl ||
                      "https://cdn.discordapp.com/embed/avatars/0.png"
                    }
                    alt=""
                    className="size-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] text-foreground">
                    {discordDisplayName || discordUsername || "Discord"}
                  </p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    @{discordUsername || "unknown"}
                    {!discordLoginEnabled ? " · Login off" : ""}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      disabled={discordBusy}
                      aria-label="Discord account options"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      disabled={discordBusy}
                      onSelect={() =>
                        void setDiscordLogin(!discordLoginEnabled)
                      }
                    >
                      {discordLoginEnabled
                        ? "Disable for login"
                        : "Enable for login"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={discordBusy}
                      className="text-destructive focus:text-destructive"
                      onSelect={() => void unlinkDiscord()}
                    >
                      Unlink Discord
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </InsetGroup>
          ) : (
            <Button
              type="button"
              className={AUTH_SUBMIT}
              disabled={discordBusy}
              onClick={() => void linkDiscord()}
            >
              {discordBusy ? "Opening…" : "Link Discord account"}
            </Button>
          )}

          {discordPresenceReady ? (
            <InsetGroup>
              <div
                className={cn(
                  "flex min-h-14 items-center justify-between gap-4 px-4",
                  !discordLinked && "opacity-60",
                )}
              >
                <div>
                  <p className="text-[17px]">Show listening status</p>
                  {!discordLinked ? (
                    <p className="text-[13px] text-muted-foreground">
                      Link Discord to enable this.
                    </p>
                  ) : null}
                </div>
                <Switch
                  checked={discordPresence && discordLinked}
                  disabled={!discordLinked}
                  onCheckedChange={(v) => void togglePresence(v)}
                  aria-label="Show listening status on Discord"
                />
              </div>
            </InsetGroup>
          ) : (
            <p className="text-[15px] text-muted-foreground">
              Listening status needs a Discord Application Client ID (Admin →
              Notifications).
            </p>
          )}
        </section>
      ) : null}

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import playlist</DialogTitle>
            <DialogDescription>
              Pick a service and paste the playlist link.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SERVICES.map((s) => {
              const ready =
                serviceReady[s.id] !== false ||
                s.id === "youtube" ||
                s.id === "deezer";
              const disabled = s.id === "apple";
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setService(s.id);
                  }}
                  className={cn(
                    "rounded-lg border px-2 py-3 text-center text-sm font-medium transition-colors",
                    service === s.id
                      ? "border-foreground bg-muted"
                      : "border-border hover:border-foreground/40",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  {s.label}
                  {!ready && s.id === "spotify" ? (
                    <span className="mt-1 block text-[10px] font-normal text-muted-foreground">
                      Needs setup
                    </span>
                  ) : null}
                  {s.id === "apple" ? (
                    <span className="mt-1 block text-[10px] font-normal text-muted-foreground">
                      Soon
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="import-url">{active.hint}</Label>
              <Input
                id="import-url"
                value={playlistUrl}
                onChange={(e) => setPlaylistUrl(e.target.value)}
                placeholder={active.placeholder}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-name">Name (optional)</Label>
              <Input
                id="import-name"
                value={playlistName}
                onChange={(e) => setPlaylistName(e.target.value)}
                placeholder="Uses the playlist title if empty"
                maxLength={80}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setImportOpen(false)}
            >
              Close
            </Button>
            <Button
              type="button"
              disabled={importing || service === "apple"}
              onClick={() => void runImport()}
            >
              {importing ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
