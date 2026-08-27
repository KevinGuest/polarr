"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  const [discordPresence, setDiscordPresence] = useState(false);
  const [discordOAuthReady, setDiscordOAuthReady] = useState(false);
  const [discordPresenceReady, setDiscordPresenceReady] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);

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
        setDiscordLinked(Boolean(data.discord?.linked));
        setDiscordUsername(
          typeof data.discord?.username === "string"
            ? data.discord.username
            : null,
        );
        setDiscordPresence(Boolean(data.discord?.presenceEnabled));
        setDiscordOAuthReady(Boolean(data.discordOAuthReady));
        setDiscordPresenceReady(
          Boolean(data.discordPresenceReady || data.discordClientId),
        );
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
      setDiscordLinked(true);
      setTab("discord");
      void fetch("/api/account")
        .then((r) => r.json())
        .then((data) => {
          setDiscordLinked(Boolean(data.discord?.linked));
          setDiscordUsername(data.discord?.username || null);
          setDiscordPresence(Boolean(data.discord?.presenceEnabled));
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
      setDiscordPresence(false);
      toastSuccess("Discord unlinked");
    } finally {
      setDiscordBusy(false);
    }
  }

  async function togglePresence(enabled: boolean) {
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
    toastSaved(
      enabled
        ? "Listening status on"
        : "Listening status off",
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const active = SERVICES.find((s) => s.id === service)!;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Profile, playlists, and Discord.
          </p>
        </div>
        <nav className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "profile" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>
                Username and email for this account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="account-username">Username</Label>
                <Input
                  id="account-username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={40}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-email">Email</Label>
                <Input
                  id="account-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <Button
                type="button"
                disabled={savingProfile || !username.trim() || !email.trim()}
                onClick={() => void saveProfile()}
              >
                {savingProfile ? "Saving…" : "Save profile"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>Change the password you sign in with.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current password</Label>
                <PasswordInput
                  id="current-password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <PasswordInput
                  id="new-password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  At least {MIN_PASSWORD_LENGTH} characters
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <PasswordInput
                  id="confirm-password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button
                type="button"
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
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === "playlists" ? (
        <Card>
          <CardHeader>
            <CardTitle>Import playlist</CardTitle>
            <CardDescription>
              Pull a playlist from Spotify, YouTube Music, or Deezer with a link.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {importResult ? (
              <div className="space-y-2 rounded-md border border-border px-3 py-3 text-sm">
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
            ) : null}
            <Button type="button" onClick={() => setImportOpen(true)}>
              Import playlist
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {tab === "discord" ? (
        <Card>
          <CardHeader>
            <CardTitle>Discord</CardTitle>
            <CardDescription>
              Show what you’re listening to as Rich Presence while Discord
              desktop is open on this machine. An admin configures this
              server’s Discord Application Client ID under Admin →
              Notifications. Best with the Polarr desktop app; browser tabs
              can work if Discord allows local RPC from your server origin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!discordPresenceReady ? (
              <p className="text-sm text-muted-foreground">
                An admin hasn’t set a Discord Application Client ID yet (Admin →
                Notifications).
              </p>
            ) : (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3">
                <div>
                  <p className="text-sm font-medium">Show listening status</p>
                  <p className="text-xs text-muted-foreground">
                    Requires Discord desktop running locally.
                  </p>
                </div>
                <Switch
                  checked={discordPresence}
                  onCheckedChange={(v) => void togglePresence(v)}
                  aria-label="Show listening status on Discord"
                />
              </div>
            )}
            {discordOAuthReady ? (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Optional link
                </p>
                <p className="text-sm text-muted-foreground">
                  Linking lets you sign in with Discord on the login page
                  (same Discord app / redirect URI).
                </p>
                {discordLinked ? (
                  <>
                    <p className="text-sm text-foreground">
                      Linked as{" "}
                      <span className="font-medium">
                        {discordUsername || "Discord"}
                      </span>
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={discordBusy}
                      onClick={() => void unlinkDiscord()}
                    >
                      Unlink Discord
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={discordBusy}
                    onClick={() => void linkDiscord()}
                  >
                    {discordBusy ? "Opening…" : "Link Discord account"}
                  </Button>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
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
