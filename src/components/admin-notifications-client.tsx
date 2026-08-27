"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AtSign,
  Eye,
  EyeOff,
  Info,
  MessageSquare,
  Pencil,
} from "lucide-react";
import { ConnectionStatusIcon } from "@/components/connection-status-icon";
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
  DEFAULT_NOTIFY_EVENTS,
  NOTIFY_EVENTS,
  type NotifyEventFlags,
  type NotifyEventId,
} from "@/lib/notify-events";
import { toastError, toastSaved } from "@/lib/toast";

type Channel = "email" | "discord";

const MASK = "••••••••";

export function AdminNotificationsClient() {
  const [channel, setChannel] = useState<Channel>("discord");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [emailEvents, setEmailEvents] = useState<NotifyEventFlags>({
    ...DEFAULT_NOTIFY_EVENTS,
  });
  const [discordEvents, setDiscordEvents] = useState<NotifyEventFlags>({
    ...DEFAULT_NOTIFY_EVENTS,
  });
  const [smtpReady, setSmtpReady] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [presenceConfigured, setPresenceConfigured] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  /** Saved webhook is considered “tested until you change values”. */
  const [webhookValidated, setWebhookValidated] = useState(false);

  const [howtoOpen, setHowtoOpen] = useState(false);
  const [webhookHowtoOpen, setWebhookHowtoOpen] = useState(false);

  const [appEditOpen, setAppEditOpen] = useState(false);
  const [editClientId, setEditClientId] = useState("");
  const [editClientSecret, setEditClientSecret] = useState("");
  const [appRevealed, setAppRevealed] = useState(false);

  const [webhookEditOpen, setWebhookEditOpen] = useState(false);
  const [editWebhook, setEditWebhook] = useState("");
  const [webhookRevealed, setWebhookRevealed] = useState(false);
  /** URL loaded when dialog opened / revealed — used to detect dirty. */
  const [webhookOpenBaseline, setWebhookOpenBaseline] = useState<string | null>(
    null,
  );
  const [webhookDraftTestedKey, setWebhookDraftTestedKey] = useState<
    string | null
  >(null);

  const [revealOpen, setRevealOpen] = useState(false);
  const [revealTarget, setRevealTarget] = useState<"app" | "webhook" | null>(
    null,
  );
  const [revealPassword, setRevealPassword] = useState("");
  const [revealBusy, setRevealBusy] = useState(false);
  const [showClientId, setShowClientId] = useState(false);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/settings");
      if (cancelled) return;
      if (res.status === 403 || res.status === 401) {
        setForbidden(true);
        setLoading(false);
        return;
      }
      const settings = await res.json();
      setEmailEnabled(Boolean(settings.notifyEmailEnabled));
      const wh = Boolean(settings.discordWebhookConfigured);
      setWebhookSaved(wh);
      setWebhookValidated(wh);
      setEmailEvents({
        ...DEFAULT_NOTIFY_EVENTS,
        ...(settings.notifyEmailEvents || {}),
      });
      setDiscordEvents({
        ...DEFAULT_NOTIFY_EVENTS,
        ...(settings.notifyDiscordEvents || {}),
      });
      setSmtpReady(Boolean(settings.smtpConfigured));
      setPresenceConfigured(Boolean(settings.discordPresenceConfigured));
      setOauthConfigured(Boolean(settings.discordOAuthConfigured));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function persist(
    partial: Record<string, unknown>,
    opts?: { successToast?: string },
  ) {
    setSaving(true);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      setSaving(false);
      return false;
    }
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      toastError(
        typeof data.error === "string"
          ? data.error
          : "Could not save notification settings",
      );
      return false;
    }
    if (data.settings) {
      setEmailEnabled(Boolean(data.settings.notifyEmailEnabled));
      const wh = Boolean(data.settings.discordWebhookConfigured);
      setWebhookSaved(wh);
      setEmailEvents({
        ...DEFAULT_NOTIFY_EVENTS,
        ...(data.settings.notifyEmailEvents || {}),
      });
      setDiscordEvents({
        ...DEFAULT_NOTIFY_EVENTS,
        ...(data.settings.notifyDiscordEvents || {}),
      });
      setSmtpReady(Boolean(data.settings.smtpConfigured));
      setPresenceConfigured(Boolean(data.settings.discordPresenceConfigured));
      setOauthConfigured(Boolean(data.settings.discordOAuthConfigured));
    }
    if (opts?.successToast) toastSaved(opts.successToast);
    return true;
  }

  function openAppEdit() {
    setEditClientId("");
    setEditClientSecret("");
    setAppRevealed(false);
    setShowClientId(false);
    setShowClientSecret(false);
    setAppEditOpen(true);
  }

  function openWebhookEdit() {
    setEditWebhook("");
    setWebhookRevealed(false);
    setShowWebhook(false);
    setWebhookDraftTestedKey(null);
    setWebhookOpenBaseline(null);
    setWebhookEditOpen(true);
  }

  function requestReveal(target: "app" | "webhook") {
    setRevealTarget(target);
    setRevealPassword("");
    setRevealOpen(true);
  }

  async function confirmReveal() {
    if (!revealPassword.trim()) {
      toastError("Enter your account password");
      return;
    }
    setRevealBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revealDiscordSecrets: true,
          password: revealPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string"
            ? data.error
            : "Could not reveal secrets",
        );
        return;
      }
      const secrets = data.secrets as {
        discordClientId?: string;
        discordClientSecret?: string;
        discordWebhookUrl?: string;
      };
      if (revealTarget === "app") {
        setEditClientId(secrets.discordClientId || "");
        setEditClientSecret(secrets.discordClientSecret || "");
        setAppRevealed(true);
        setShowClientId(true);
        setShowClientSecret(true);
      } else if (revealTarget === "webhook") {
        const url = secrets.discordWebhookUrl || "";
        setEditWebhook(url);
        setWebhookRevealed(true);
        setShowWebhook(true);
        setWebhookOpenBaseline(url.trim());
        // Revealed saved URL still counts as tested until edited.
        if (url.trim()) setWebhookDraftTestedKey(url.trim());
        else setWebhookDraftTestedKey(null);
      }
      setRevealOpen(false);
      setRevealPassword("");
    } finally {
      setRevealBusy(false);
    }
  }

  function onSecretEyeClick(
    target: "app" | "webhook",
    field: "id" | "secret" | "webhook",
  ) {
    if (target === "app") {
      if (!appRevealed && presenceConfigured) {
        requestReveal("app");
        return;
      }
      if (field === "id") setShowClientId((v) => !v);
      else setShowClientSecret((v) => !v);
      return;
    }
    if (!webhookRevealed && webhookSaved) {
      requestReveal("webhook");
      return;
    }
    setShowWebhook((v) => !v);
  }

  async function saveApp() {
    const id = editClientId.trim();
    const secret = editClientSecret.trim();
    const payload: Record<string, string> = {};
    if (id && id !== MASK) payload.discordClientId = id;
    else if (appRevealed) payload.discordClientId = id;
    if (secret && secret !== MASK) payload.discordClientSecret = secret;
    else if (appRevealed) payload.discordClientSecret = secret;

    if (!payload.discordClientId && !payload.discordClientSecret) {
      if (!presenceConfigured) {
        toastError("Enter a Client ID");
        return;
      }
      toastSaved("Unchanged");
      setAppEditOpen(false);
      return;
    }
    if (
      payload.discordClientId === undefined &&
      !presenceConfigured
    ) {
      toastError("Enter a Client ID");
      return;
    }

    const ok = await persist(payload, { successToast: "Rich Presence saved" });
    if (ok) setAppEditOpen(false);
  }

  function webhookDraftKey() {
    return editWebhook.trim();
  }

  /** True while the draft URL still needs a successful test. */
  function webhookDraftCanTest() {
    const key = webhookDraftKey();
    if (!key) return false;
    return webhookDraftTestedKey !== key;
  }

  function webhookDraftTestPassed() {
    const key = webhookDraftKey();
    if (!key) {
      // Clearing is allowed without test
      return true;
    }
    return webhookDraftTestedKey === key;
  }

  /**
   * Something to persist: new tested URL different from the opened baseline,
   * or clear a saved webhook.
   */
  function webhookCanSave() {
    const draft = webhookDraftKey();
    if (saving || testing) return false;

    // Clear: field emptied after revealing a saved webhook
    if (!draft) {
      return webhookSaved && webhookRevealed;
    }

    // New / changed URL must pass test
    if (!webhookDraftTestPassed()) return false;

    // Nothing changed vs what we opened with after reveal
    if (webhookRevealed && draft === webhookOpenBaseline) return false;

    return true;
  }

  async function saveWebhook() {
    if (!webhookCanSave()) return;
    const url = editWebhook.trim();
    if (!url) {
      const ok = await persist(
        {
          discordWebhookUrl: "",
          notifyDiscordEnabled: false,
        },
        { successToast: "Webhook cleared" },
      );
      if (ok) {
        setWebhookValidated(false);
        setWebhookEditOpen(false);
      }
      return;
    }
    if (!webhookDraftTestPassed()) {
      toastError("Run a successful test before saving");
      return;
    }
    const ok = await persist(
      {
        discordWebhookUrl: url,
        notifyDiscordEnabled: true,
      },
      { successToast: "Webhook saved" },
    );
    if (ok) {
      setWebhookValidated(true);
      setWebhookEditOpen(false);
    }
  }

  async function testDiscord() {
    setTesting(true);
    try {
      const payload: Record<string, unknown> = { testDiscord: true };
      if (webhookEditOpen) {
        const draft = editWebhook.trim();
        if (!draft) {
          toastError("Enter a webhook URL to test");
          return;
        }
        payload.discordWebhookUrl = draft;
      } else if (!webhookSaved) {
        toastError("Configure a webhook first");
        return;
      }
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        if (webhookEditOpen) setWebhookDraftTestedKey(null);
        else setWebhookValidated(false);
        toastError(
          typeof data.error === "string" ? data.error : "Discord test failed",
        );
        return;
      }
      if (webhookEditOpen) {
        setWebhookDraftTestedKey(editWebhook.trim());
      } else {
        setWebhookValidated(true);
      }
      toastSaved("Test message sent to Discord");
    } finally {
      setTesting(false);
    }
  }

  function setEvent(id: NotifyEventId, enabled: boolean) {
    if (channel === "email") {
      const next = { ...emailEvents, [id]: enabled };
      setEmailEvents(next);
      void persist({ notifyEmailEvents: { [id]: enabled } });
    } else {
      const next = { ...discordEvents, [id]: enabled };
      setDiscordEvents(next);
      void persist({ notifyDiscordEvents: { [id]: enabled } });
    }
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Admin only. Sign in with an admin account to configure notifications.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  const events = channel === "email" ? emailEvents : discordEvents;
  const channelOn = channel === "email" ? emailEnabled : webhookSaved;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {channel === "email" ? "Email" : "Discord"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {channel === "email"
              ? "SMTP delivery plus which events should email admins."
              : "Rich Presence, webhooks, and which events should post here."}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          <ChannelTab
            active={channel === "email"}
            label="Email"
            icon={AtSign}
            onClick={() => setChannel("email")}
          />
          <ChannelTab
            active={channel === "discord"}
            label="Discord"
            icon={MessageSquare}
            onClick={() => setChannel("discord")}
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {channel === "discord" ? (
            <>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <CardTitle>Rich Presence</CardTitle>
                      <button
                        type="button"
                        onClick={() => setHowtoOpen(true)}
                        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="How to set up Rich Presence"
                      >
                        <Info className="size-4" />
                      </button>
                    </div>
                    <CardDescription>
                      {presenceConfigured
                        ? oauthConfigured
                          ? "Client ID & secret configured."
                          : "Client ID configured."
                        : "Not configured — add your Discord application credentials."}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    <ConnectionStatusIcon
                      ok={presenceConfigured}
                      okLabel="Rich Presence ready"
                      badLabel="Not set up"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openAppEdit()}
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                  </div>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <CardTitle>Webhook</CardTitle>
                      <button
                        type="button"
                        onClick={() => setWebhookHowtoOpen(true)}
                        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="How to set up a webhook"
                      >
                        <Info className="size-4" />
                      </button>
                    </div>
                    <CardDescription>
                      {webhookSaved
                        ? "URL configured for event posts."
                        : "Not configured — paste a channel webhook URL."}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    <ConnectionStatusIcon
                      ok={webhookSaved && webhookValidated}
                      okLabel="Webhook working"
                      badLabel={
                        webhookSaved
                          ? "Webhook needs a successful test"
                          : "Webhook not set up"
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openWebhookEdit()}
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            </>
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div className="space-y-1.5">
                  <CardTitle>Email channel</CardTitle>
                  <CardDescription>
                    Uses SMTP from{" "}
                    <Link
                      href="/admin/email"
                      className="underline underline-offset-2"
                    >
                      Admin → SMTP
                    </Link>
                    .
                  </CardDescription>
                </div>
                <Switch
                  checked={emailEnabled}
                  onCheckedChange={(checked) => {
                    if (checked && !smtpReady) {
                      setEmailEnabled(false);
                      toastError(
                        "Set up SMTP before enabling this channel",
                      );
                      return;
                    }
                    setEmailEnabled(checked);
                    void persist({ notifyEmailEnabled: checked });
                  }}
                  aria-label="Enable email notifications"
                />
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {smtpReady
                    ? "SMTP is configured. Event emails go to admin accounts."
                    : "SMTP is not set up yet — configure SMTP before enabling."}
                </p>
              </CardContent>
            </Card>
          )}

          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Events</h2>
            <div
              className={cn(
                "grid gap-3 sm:grid-cols-2",
                !channelOn && "opacity-50",
              )}
            >
              {NOTIFY_EVENTS.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-border px-4 py-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{event.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.description}
                    </p>
                  </div>
                  <Switch
                    checked={Boolean(events[event.id])}
                    disabled={!channelOn}
                    onCheckedChange={(checked) => setEvent(event.id, checked)}
                    aria-label={`Enable ${event.label}`}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Rich Presence how-to */}
      <Dialog open={howtoOpen} onOpenChange={setHowtoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set up Rich Presence</DialogTitle>
            <DialogDescription>
              Each Polarr server uses its own Discord application.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Open{" "}
              <a
                href="https://discord.com/developers/applications"
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                discord.com/developers
              </a>{" "}
              and create an application.
            </li>
            <li>
              Name the application{" "}
              <span className="font-medium text-foreground">Polarr</span> so
              Discord shows “Listening to Polarr”.
            </li>
            <li>
              Copy the{" "}
              <span className="font-medium text-foreground">Client ID</span> —
              required for listening status.
            </li>
            <li>
              Optional: Client Secret + redirect{" "}
              <code className="rounded bg-muted px-1 text-xs text-foreground">
                {"{public URL}/api/discord/callback"}
              </code>{" "}
              only if users should “Link Discord” on their account.
            </li>
            <li>Click Edit on Rich Presence and paste the values, then Save.</li>
            <li>
              Users open the{" "}
              <span className="font-medium text-foreground">
                Polarr desktop app
              </span>
              , enable{" "}
              <span className="font-medium text-foreground">
                Show listening status
              </span>{" "}
              under Settings → Discord, and play a track with Discord desktop
              running as the same Windows user.
            </li>
          </ol>
        </DialogContent>
      </Dialog>

      {/* Webhook how-to */}
      <Dialog open={webhookHowtoOpen} onOpenChange={setWebhookHowtoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set up Webhook</DialogTitle>
            <DialogDescription>
              Posts Polarr events into a Discord channel you choose.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Open your Discord server → channel settings → Integrations.</li>
            <li>Create a webhook and copy the URL.</li>
            <li>
              Click Edit on Webhook, paste the URL, run Test, then Save.
            </li>
            <li>Pick which events post using the toggles below.</li>
          </ol>
        </DialogContent>
      </Dialog>

      {/* Edit Rich Presence credentials */}
      <Dialog
        open={appEditOpen}
        onOpenChange={(open) => {
          if (!open) setAppEditOpen(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rich Presence credentials</DialogTitle>
            <DialogDescription>
              {presenceConfigured
                ? "Leave a field blank to keep the current value, or show values with the eye (password required)."
                : "Paste credentials from your Discord application."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="polarr-discord-rp-id">Client ID</Label>
              <SecretField
                id="polarr-discord-rp-id"
                name="polarr-discord-rp-id"
                value={editClientId}
                onChange={setEditClientId}
                visible={showClientId}
                onEye={() => onSecretEyeClick("app", "id")}
                placeholder={presenceConfigured ? MASK : "Client ID"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="polarr-discord-rp-key">
                Client secret{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <SecretField
                id="polarr-discord-rp-key"
                name="polarr-discord-rp-key"
                value={editClientSecret}
                onChange={setEditClientSecret}
                visible={showClientSecret}
                onEye={() => onSecretEyeClick("app", "secret")}
                placeholder={presenceConfigured ? MASK : "Client secret"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void saveApp()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Webhook */}
      <Dialog
        open={webhookEditOpen}
        onOpenChange={(open) => {
          if (!open) setWebhookEditOpen(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Webhook URL</DialogTitle>
            <DialogDescription>
              Test the URL, then save. Leave blank and save to clear.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="polarr-discord-wh-url">URL</Label>
            <SecretField
              id="polarr-discord-wh-url"
              name="polarr-discord-wh-url"
              value={editWebhook}
              onChange={(v) => {
                setEditWebhook(v);
              }}
              visible={showWebhook}
              onEye={() => onSecretEyeClick("webhook", "webhook")}
              placeholder={
                webhookSaved
                  ? MASK
                  : "https://discord.com/api/webhooks/…"
              }
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            {webhookDraftCanTest() || testing ? (
              <Button
                type="button"
                variant="secondary"
                disabled={testing}
                onClick={() => void testDiscord()}
              >
                {testing ? "Sending…" : "Test"}
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={!webhookCanSave()}
              onClick={() => void saveWebhook()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password to reveal secrets */}
      <Dialog
        open={revealOpen}
        onOpenChange={(open) => {
          if (!open) {
            setRevealOpen(false);
            setRevealPassword("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm password</DialogTitle>
            <DialogDescription>
              Enter your Polarr account password to view stored credentials.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reveal-password">Password</Label>
            <PasswordInput
              id="reveal-password"
              value={revealPassword}
              onChange={(e) => setRevealPassword(e.target.value)}
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmReveal();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={revealBusy}
              onClick={() => void confirmReveal()}
            >
              {revealBusy ? "Checking…" : "Show credentials"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SecretField({
  id,
  name,
  value,
  onChange,
  visible,
  onEye,
  placeholder,
}: {
  id: string;
  /** Non-login name so passkeepers don't treat this as a password field. */
  name?: string;
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onEye: () => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      {/*
        type=text + CSS masking (not type=password) so 1Password / Bitwarden /
        browser autofill don't treat Discord keys & webhooks as login password.
      */}
      <Input
        id={id}
        name={name ?? id}
        type="text"
        inputMode="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        className={cn(
          "pr-10",
          !visible &&
            "[-webkit-text-security:disc] [text-security:disc]",
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={onEye}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={visible ? "Hide" : "Show"}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function ChannelTab({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: typeof AtSign;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      aria-pressed={active}
    >
      <Icon className="size-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
