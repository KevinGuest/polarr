"use client";

import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
import { isPolarrDesktop } from "@/lib/desktop-shell";
import {
  DEFAULT_PLAYBACK_SETTINGS,
  EQ_FREQUENCIES,
  EQ_PRESETS,
  readPlaybackSettings,
  writePlaybackSettings,
  type EqPreset,
  type PlaybackSettings,
  type VolumeLevel,
} from "@/lib/playback-settings";
import {
  isPasswordLongEnough,
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_SHORT_MSG,
} from "@/lib/auth-password";
import { invalidateDiscordPresenceCache } from "@/components/player-provider";
import { toastError, toastSaved, toastSuccess } from "@/lib/toast";
import {
  ArrowLeft,
  ChevronRight,
  Info,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SettingsTab =
  | "home"
  | "server"
  | "account"
  | "playlists"
  | "playback"
  | "discord";
type AccountEdit = "username" | "email" | "password" | null;

type AudioOutputOption = {
  deviceId: string;
  label: string;
};

type AudioOutputMediaDevices = MediaDevices & {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>;
};

type ImportSummary = {
  playlistId: string;
  name: string;
  matched: number;
  unresolved: number;
  total: number;
};

type ServiceId = "spotify" | "youtube" | "deezer" | "apple";

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

function SettingsRow({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 w-full items-center gap-3 border-b border-border/70 px-4 py-3 text-left last:border-b-0 hover:bg-muted/40"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium text-foreground">
          {title}
        </span>
        {detail ? (
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function formatEqFrequency(frequency: number): string {
  return frequency >= 1000
    ? `${Number((frequency / 1000).toFixed(1))}kHz`
    : `${frequency}Hz`;
}

function EqualizerChart({
  bands,
  enabled,
  onChange,
}: {
  bands: number[];
  enabled: boolean;
  onChange: (index: number, value: number) => void;
}) {
  const width = 720;
  const height = 280;
  const left = 62;
  const right = 662;
  const top = 34;
  const bottom = 218;
  const middle = (top + bottom) / 2;
  const range = (bottom - top) / 2;
  const points = EQ_FREQUENCIES.map((_, index) => {
    const x = left + ((right - left) * index) / (EQ_FREQUENCIES.length - 1);
    const value = Math.max(-12, Math.min(12, bands[index] || 0));
    const y = middle - (value / 12) * range;
    return { x, y, value };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `M ${left} ${bottom} L ${line.replaceAll(" ", " L ")} L ${right} ${bottom} Z`;

  function valueFromPointer(event: ReactPointerEvent<SVGCircleElement>) {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const y = ((event.clientY - rect.top) / rect.height) * height;
    const value = Math.round(((middle - y) / range) * 12);
    const index = Number(event.currentTarget.dataset.index);
    onChange(index, Math.max(-12, Math.min(12, value)));
  }

  function moveWithKeyboard(
    event: ReactKeyboardEvent<SVGCircleElement>,
    index: number,
  ) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onChange(
      index,
      Math.max(
        -12,
        Math.min(12, (bands[index] || 0) + (event.key === "ArrowUp" ? 1 : -1)),
      ),
    );
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block h-auto w-full overflow-visible text-foreground"
      aria-label="Six-band equalizer"
    >
      <defs>
        <linearGradient id="equalizer-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <text x="0" y={top + 7} className="fill-muted-foreground text-[15px] font-semibold">
        +12dB
      </text>
      <text x="0" y={bottom + 6} className="fill-muted-foreground text-[15px] font-semibold">
        −12dB
      </text>
      <line x1={left} x2={right} y1={middle} y2={middle} className="stroke-border" />
      {points.map((point, index) => (
        <line
          key={`rail-${EQ_FREQUENCIES[index]}`}
          x1={point.x}
          x2={point.x}
          y1={top}
          y2={bottom}
          className="stroke-border"
        />
      ))}
      <path d={area} fill="url(#equalizer-fill)" className="transition-all" />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
        className="transition-all"
      />
      {points.map((point, index) => (
        <g key={EQ_FREQUENCIES[index]}>
          <circle
            cx={point.x}
            cy={point.y}
            r="12"
            fill="transparent"
            className={enabled ? "cursor-ns-resize" : "cursor-not-allowed"}
            data-index={index}
            onPointerDown={(event) => {
              if (!enabled) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              valueFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (enabled && event.currentTarget.hasPointerCapture(event.pointerId)) {
                valueFromPointer(event);
              }
            }}
            onKeyDown={(event) => enabled && moveWithKeyboard(event, index)}
            tabIndex={enabled ? 0 : -1}
            role="slider"
            aria-label={`${formatEqFrequency(EQ_FREQUENCIES[index])} gain`}
            aria-valuemin={-12}
            aria-valuemax={12}
            aria-valuenow={point.value}
          />
          <circle
            cx={point.x}
            cy={point.y}
            r="5.5"
            className="pointer-events-none fill-foreground transition-all"
          />
          <text
            x={point.x}
            y={bottom + 42}
            textAnchor="middle"
            className="fill-muted-foreground text-[14px] font-semibold"
          >
            {formatEqFrequency(EQ_FREQUENCIES[index])}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function SettingsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: SettingsTab =
    tabParam === "server" ||
    tabParam === "account" ||
    tabParam === "playlists" ||
    tabParam === "playback" ||
    tabParam === "discord"
      ? tabParam
      : "home";

  const [loading, setLoading] = useState(true);
  const [playback, setPlayback] = useState<PlaybackSettings>(() =>
    typeof window === "undefined"
      ? DEFAULT_PLAYBACK_SETTINGS
      : readPlaybackSettings(),
  );
  const [desktopApp, setDesktopApp] = useState(false);
  const [audioOutputs, setAudioOutputs] = useState<AudioOutputOption[]>([]);
  const [audioOutputBusy, setAudioOutputBusy] = useState(false);
  const [audioOutputMessage, setAudioOutputMessage] = useState<string | null>(
    null,
  );
  const [audioOutputPickerAvailable, setAudioOutputPickerAvailable] =
    useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [accountEdit, setAccountEdit] = useState<AccountEdit>(null);
  const [editValue, setEditValue] = useState("");
  const [serverVersion, setServerVersion] = useState<string | null>(null);

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

  function updatePlayback(patch: Partial<PlaybackSettings>) {
    setPlayback((current) => {
      const next = { ...current, ...patch };
      writePlaybackSettings(next);
      return next;
    });
  }

  function applyEqPreset(preset: EqPreset) {
    if (preset === "custom") return;
    updatePlayback({
      equalizerPreset: preset,
      equalizerBands: [...EQ_PRESETS[preset].bands],
    });
  }

  const refreshAudioOutputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioOutputMessage(
        "This desktop webview uses your system audio output.",
      );
      return;
    }
    setAudioOutputBusy(true);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices
        .filter((device) => device.kind === "audiooutput")
        .filter((device) => device.deviceId && device.deviceId !== "default")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Audio output ${index + 1}`,
        }));
      setAudioOutputs(outputs);
      setAudioOutputMessage(
        outputs.length > 0
          ? null
          : "No individual outputs were exposed. Polarr will follow your system output.",
      );
    } catch {
      setAudioOutputMessage(
        "Polarr could not read audio outputs. It will follow your system output.",
      );
    } finally {
      setAudioOutputBusy(false);
    }
  }, []);

  async function chooseAudioOutput() {
    const mediaDevices = navigator.mediaDevices as AudioOutputMediaDevices;
    if (typeof mediaDevices?.selectAudioOutput !== "function") {
      await refreshAudioOutputs();
      return;
    }
    setAudioOutputBusy(true);
    try {
      const selected = await mediaDevices.selectAudioOutput();
      if (!selected.deviceId) return;
      setAudioOutputs((current) => [
        {
          deviceId: selected.deviceId,
          label: selected.label || "Selected audio output",
        },
        ...current.filter((device) => device.deviceId !== selected.deviceId),
      ]);
      updatePlayback({ outputDeviceId: selected.deviceId });
      setAudioOutputMessage(null);
    } catch (error) {
      if ((error as DOMException)?.name !== "NotAllowedError") {
        setAudioOutputMessage("The audio output could not be selected.");
      }
    } finally {
      setAudioOutputBusy(false);
    }
  }

  useEffect(() => {
    const desktop = isPolarrDesktop();
    queueMicrotask(() => setDesktopApp(desktop));
    if (!desktop) return;
    const mediaDevices = navigator.mediaDevices as AudioOutputMediaDevices;
    queueMicrotask(() =>
      setAudioOutputPickerAvailable(
        typeof mediaDevices?.selectAudioOutput === "function",
      ),
    );
    queueMicrotask(() => void refreshAudioOutputs());
    const refresh = () => void refreshAudioOutputs();
    mediaDevices?.addEventListener?.("devicechange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      mediaDevices?.removeEventListener?.("devicechange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshAudioOutputs]);

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
      void fetch("/api/v1/status", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled && typeof data.version === "string") {
            setServerVersion(data.version);
          }
        })
        .catch(() => null);
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

  useEffect(() => {
    const flag = searchParams.get("email");
    if (!flag) return;
    if (flag === "confirmed") {
      toastSuccess("Email address confirmed");
      void fetch("/api/account", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (typeof data.email === "string") setEmail(data.email);
        })
        .catch(() => null);
    } else {
      toastError("That email confirmation link is invalid or expired");
    }
    router.replace("/settings?tab=account", { scroll: false });
  }, [searchParams, router]);

  async function saveUsername() {
    setSavingProfile(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: editValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string" ? data.error : "Could not save",
        );
        return;
      }
      setUsername(data.username || editValue);
      setAccountEdit(null);
      toastSaved("Username updated");
    } finally {
      setSavingProfile(false);
    }
  }

  async function requestEmailChange() {
    setSavingProfile(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: editValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string"
            ? data.error
            : "Could not request email change",
        );
        return;
      }
      setAccountEdit(null);
      toastSuccess(
        "Confirmation email sent",
        `Check ${data.pendingEmail || editValue}`,
      );
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
      setAccountEdit(null);
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
  const settingsTitle =
    tab === "home"
      ? "Settings"
      : tab === "server"
        ? "Server Info"
        : tab === "account"
          ? "Account"
          : tab === "playlists"
            ? "Playlists"
            : tab === "playback"
              ? "Playback"
              : "Discord";
  const settingsDescription =
    tab === "home"
      ? "Manage Polarr and your connections."
      : tab === "account"
        ? "Account information and sign-in security."
        : tab === "server"
          ? "Information about this Polarr server."
          : tab === "playlists"
            ? "Bring playlists into your library."
            : tab === "playback"
              ? "Shape how music sounds and moves between songs."
              : "Discord account and listening presence.";

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-1">
        <div className="flex min-w-0 items-center gap-3">
          {tab !== "home" ? (
            <button
              type="button"
              onClick={() => setTab("home")}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted"
              aria-label="Back to settings"
            >
              <ArrowLeft className="size-5" />
            </button>
          ) : null}
          <h1 className="min-w-0 text-[2rem] font-semibold tracking-tight">
            {settingsTitle}
          </h1>
        </div>
        <p
          className={cn(
            "text-[15px] text-muted-foreground",
            tab !== "home" && "pl-12",
          )}
        >
          {settingsDescription}
        </p>
      </div>

      {tab === "home" ? (
        <>
          <section className="space-y-2">
            <InsetGroup>
              <SettingsRow
                title="Server Info"
                detail={serverVersion ? `Polarr ${serverVersion}` : "This Polarr server"}
                onClick={() => setTab("server")}
              />
              <SettingsRow
                title="Account"
                detail={username}
                onClick={() => setTab("account")}
              />
            </InsetGroup>
          </section>
          <section className="space-y-2">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Music
            </h2>
            <InsetGroup>
              <SettingsRow
                title="Playlists"
                detail="Import and manage playlist connections"
                onClick={() => setTab("playlists")}
              />
              <SettingsRow
                title="Playback"
                detail="Equalizer, transitions, volume, and audio output"
                onClick={() => setTab("playback")}
              />
            </InsetGroup>
          </section>
          <section className="space-y-2">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Connections
            </h2>
            <InsetGroup>
              <SettingsRow
                title="Discord"
                detail={discordLinked ? discordDisplayName || discordUsername : "Not linked"}
                onClick={() => setTab("discord")}
              />
            </InsetGroup>
          </section>
        </>
      ) : null}

      {tab === "server" ? (
        <InsetGroup>
          <div className="flex min-h-16 items-center gap-3 px-4 py-3">
            <Info className="size-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-medium">Polarr version</p>
              <p className="text-sm text-muted-foreground">
                {serverVersion || "Loading…"}
              </p>
            </div>
          </div>
        </InsetGroup>
      ) : null}

      {tab === "account" ? (
        <InsetGroup>
          <SettingsRow
            title="Username"
            detail={username}
            onClick={() => {
              setEditValue(username);
              setAccountEdit("username");
            }}
          />
          <SettingsRow
            title="Email"
            detail={email}
            onClick={() => {
              setEditValue(email);
              setAccountEdit("email");
            }}
          />
          <SettingsRow
            title="Password"
            detail="Change your sign-in password"
            onClick={() => setAccountEdit("password")}
          />
        </InsetGroup>
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

      {tab === "playback" ? (
        <div className="space-y-7">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-[1.375rem] font-semibold tracking-tight">
                  Equalizer
                </h2>
                <p className="text-sm text-muted-foreground">
                  Adjust the balance of bass, mids, and treble.
                </p>
              </div>
              <Switch
                checked={playback.equalizerEnabled}
                onCheckedChange={(equalizerEnabled) =>
                  updatePlayback({ equalizerEnabled })
                }
                aria-label="Enable equalizer"
              />
            </div>
            <InsetGroup>
              <div
                className={cn(
                  "space-y-5 px-4 py-4 transition-opacity sm:px-6 sm:py-5",
                  !playback.equalizerEnabled && "opacity-50",
                )}
              >
                <label className="flex max-w-xs items-center gap-5">
                  <span className="text-sm font-medium text-muted-foreground">
                    Preset
                  </span>
                  <select
                    value={playback.equalizerPreset}
                    onChange={(event) =>
                      applyEqPreset(event.target.value as EqPreset)
                    }
                    className="h-9 min-w-36 flex-1 appearance-none rounded-md border-0 bg-transparent px-3 text-sm outline-none hover:bg-muted focus:ring-2 focus:ring-ring"
                    disabled={!playback.equalizerEnabled}
                  >
                    {Object.entries(EQ_PRESETS).map(([id, preset]) => (
                      <option key={id} value={id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mx-auto max-w-[48rem] pt-1">
                  <EqualizerChart
                    bands={playback.equalizerBands}
                    enabled={playback.equalizerEnabled}
                    onChange={(index, value) => {
                      const bands = [...playback.equalizerBands];
                      bands[index] = value;
                      updatePlayback({
                        equalizerPreset: "custom",
                        equalizerBands: bands,
                      });
                    }}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full px-5"
                    disabled={!playback.equalizerEnabled}
                    onClick={() => applyEqPreset("flat")}
                  >
                    Reset
                  </Button>
                </div>
              </div>
            </InsetGroup>
          </section>

          <section className="space-y-2">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Transitions
            </h2>
            <InsetGroup>
              <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-[16px] font-medium">Crossfade songs</p>
                  <p className="text-sm text-muted-foreground">Blend the end of one song into the next.</p>
                </div>
                <Switch checked={playback.crossfadeEnabled} onCheckedChange={(crossfadeEnabled) => updatePlayback({ crossfadeEnabled })} />
              </div>
              {playback.crossfadeEnabled ? (
                <div className="border-t border-border/70 px-4 py-3">
                  <div className="mb-2 flex justify-between text-sm"><span>Duration</span><span className="text-muted-foreground">{playback.crossfadeSeconds} seconds</span></div>
                  <input type="range" min={1} max={12} value={playback.crossfadeSeconds} onChange={(event) => updatePlayback({ crossfadeSeconds: Number(event.target.value) })} className="w-full accent-foreground" />
                </div>
              ) : null}
              <div className="flex min-h-16 items-center justify-between gap-4 border-t border-border/70 px-4 py-3">
                <div>
                  <p className="text-[16px] font-medium">Gapless playback</p>
                  <p className="text-sm text-muted-foreground">Remove silence between consecutive tracks.</p>
                </div>
                <Switch checked={playback.gaplessEnabled} onCheckedChange={(gaplessEnabled) => updatePlayback({ gaplessEnabled })} />
              </div>
            </InsetGroup>
          </section>

          <section className="space-y-2">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Audio</h2>
            <InsetGroup>
              <div className="space-y-2 px-4 py-3">
                <Label htmlFor="volume-level">Volume level</Label>
                <select id="volume-level" value={playback.volumeLevel} onChange={(event) => updatePlayback({ volumeLevel: event.target.value as VolumeLevel })} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                  <option value="quiet">Quiet</option>
                  <option value="normal">Normal</option>
                  <option value="loud">Loud</option>
                </select>
                <p className="text-sm text-muted-foreground">
                  Quiet and Normal preserve audio quality. Loud may diminish audio quality.
                </p>
              </div>
              <div className="flex min-h-16 items-center justify-between gap-4 border-t border-border/70 px-4 py-3">
                <div><p className="text-[16px] font-medium">Mono audio</p><p className="text-sm text-muted-foreground">Play the same sound through both channels.</p></div>
                <Switch checked={playback.monoAudio} onCheckedChange={(monoAudio) => updatePlayback({ monoAudio })} />
              </div>
            </InsetGroup>
          </section>

          {desktopApp ? (
            <section className="space-y-2">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Output</h2>
              <InsetGroup>
                <div className="space-y-2 px-4 py-3">
                  <Label htmlFor="audio-output">Audio output</Label>
                  <select id="audio-output" value={playback.outputDeviceId} onChange={(event) => updatePlayback({ outputDeviceId: event.target.value })} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                    <option value="default">System default</option>
                    {audioOutputs.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                    ))}
                  </select>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {audioOutputPickerAvailable ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={audioOutputBusy}
                        onClick={() => void chooseAudioOutput()}
                      >
                        Choose device
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={audioOutputBusy}
                      onClick={() => void refreshAudioOutputs()}
                    >
                      {audioOutputBusy ? "Checking…" : "Refresh devices"}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {audioOutputMessage ||
                      "Choose a connected speaker, headphone, or other audio device."}
                  </p>
                </div>
              </InsetGroup>
            </section>
          ) : null}
        </div>
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
        open={accountEdit !== null}
        onOpenChange={(open) => {
          if (!open) setAccountEdit(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {accountEdit === "username"
                ? "Edit username"
                : accountEdit === "email"
                  ? "Change email"
                  : "Change password"}
            </DialogTitle>
            <DialogDescription>
              {accountEdit === "email"
                ? "We’ll send a confirmation link to the new address before changing it."
                : accountEdit === "password"
                  ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
                  : "This is how your name appears across Polarr."}
            </DialogDescription>
          </DialogHeader>

          {accountEdit === "username" ? (
            <Input
              autoComplete="username"
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              maxLength={40}
              placeholder="Username"
              className={AUTH_CONTROL}
            />
          ) : accountEdit === "email" ? (
            <Input
              type="email"
              autoComplete="email"
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              placeholder="New email address"
              className={AUTH_CONTROL}
            />
          ) : (
            <AuthFieldGroup>
              <PasswordInput
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="Current password"
                className={AUTH_CONTROL}
              />
              <PasswordInput
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="New password"
                className={AUTH_CONTROL}
              />
              <PasswordInput
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm new password"
                className={AUTH_CONTROL}
              />
            </AuthFieldGroup>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAccountEdit(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                accountEdit === "password"
                  ? savingPassword || !currentPassword || !newPassword || !confirmPassword
                  : savingProfile || !editValue.trim()
              }
              onClick={() => {
                if (accountEdit === "username") void saveUsername();
                else if (accountEdit === "email") void requestEmailChange();
                else void savePassword();
              }}
            >
              {savingProfile || savingPassword
                ? "Saving…"
                : accountEdit === "email"
                  ? "Send confirmation"
                  : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
