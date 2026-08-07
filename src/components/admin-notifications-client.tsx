"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AtSign, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  DEFAULT_NOTIFY_EVENTS,
  NOTIFY_EVENTS,
  type NotifyEventFlags,
  type NotifyEventId,
} from "@/lib/notify-events";

type Channel = "email" | "discord";

export function AdminNotificationsClient() {
  const [channel, setChannel] = useState<Channel>("discord");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [webhook, setWebhook] = useState("");
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
  const [discordClientId, setDiscordClientId] = useState("");
  const [discordClientSecret, setDiscordClientSecret] = useState("");
  const [oauthMsg, setOauthMsg] = useState<string | null>(null);

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
      setDiscordEnabled(Boolean(settings.notifyDiscordEnabled));
      setWebhook("");
      setWebhookSaved(Boolean(settings.discordWebhookConfigured));
      setEmailEvents({
        ...DEFAULT_NOTIFY_EVENTS,
        ...(settings.notifyEmailEvents || {}),
      });
      setDiscordEvents({
        ...DEFAULT_NOTIFY_EVENTS,
        ...(settings.notifyDiscordEvents || {}),
      });
      setSmtpReady(Boolean(settings.smtpConfigured));
      setDiscordClientId(settings.discordClientId || "");
      setDiscordClientSecret(settings.discordClientSecret || "");
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
      toast.error(
        typeof data.error === "string"
          ? data.error
          : "Could not save notification settings",
      );
      return false;
    }
    if (data.settings) {
      setEmailEnabled(Boolean(data.settings.notifyEmailEnabled));
      setDiscordEnabled(Boolean(data.settings.notifyDiscordEnabled));
      setWebhookSaved(Boolean(data.settings.discordWebhookConfigured));
      setEmailEvents({
        ...DEFAULT_NOTIFY_EVENTS,
        ...(data.settings.notifyEmailEvents || {}),
      });
      setDiscordEvents({
        ...DEFAULT_NOTIFY_EVENTS,
        ...(data.settings.notifyDiscordEvents || {}),
      });
      setSmtpReady(Boolean(data.settings.smtpConfigured));
    }
    if (opts?.successToast) toast.success(opts.successToast);
    return true;
  }

  async function testDiscord() {
    setTesting(true);
    const payload: Record<string, unknown> = { testDiscord: true };
    if (webhook.trim()) payload.discordWebhookUrl = webhook.trim();
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setTesting(false);
    if (!res.ok) {
      toast.error(
        typeof data.error === "string" ? data.error : "Discord test failed",
      );
      return;
    }
    toast.success("Test message sent to Discord");
  }

  async function saveWebhook() {
    if (!webhook.trim()) {
      if (webhookSaved) {
        toast.success("Webhook unchanged");
        return;
      }
      toast.error("Enter a Discord webhook URL");
      return;
    }
    const ok = await persist(
      { discordWebhookUrl: webhook.trim() },
      { successToast: "Webhook saved" },
    );
    if (ok) setWebhook("");
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
  const channelOn = channel === "email" ? emailEnabled : discordEnabled;

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
              : "Webhook URL plus which events should post to this channel."}
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
              <CardHeader>
                <CardTitle>Discord app (user linking)</CardTitle>
                <CardDescription>
                  Create an application at{" "}
                  <a
                    href="https://discord.com/developers/applications"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    discord.com/developers
                  </a>
                  . Add redirect{" "}
                  <code className="text-xs">
                    {"{public URL}/api/discord/callback"}
                  </code>
                  . Users link Discord in Settings to show listening status.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="discord-client-id">Client ID</Label>
                  <Input
                    id="discord-client-id"
                    value={discordClientId}
                    onChange={(e) => setDiscordClientId(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discord-client-secret">Client secret</Label>
                  <Input
                    id="discord-client-secret"
                    type="password"
                    value={discordClientSecret}
                    onChange={(e) => setDiscordClientSecret(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="off"
                  />
                </div>
                {oauthMsg ? (
                  <p className="text-sm text-foreground">{oauthMsg}</p>
                ) : null}
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setOauthMsg(null);
                    void persist(
                      {
                        discordClientId,
                        discordClientSecret,
                      },
                      { successToast: "Discord app saved" },
                    ).then(() => setOauthMsg("Saved"));
                  }}
                >
                  Save Discord app
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div className="space-y-1.5">
                  <CardTitle>Discord webhook</CardTitle>
                  <CardDescription>
                    One URL posts into the channel you create the webhook in.
                  </CardDescription>
                </div>
                <Switch
                  checked={discordEnabled}
                  onCheckedChange={(checked) => {
                    setDiscordEnabled(checked);
                    void persist({ notifyDiscordEnabled: checked });
                  }}
                  aria-label="Enable Discord notifications"
                />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="discord-webhook">Webhook URL</Label>
                  <Input
                    id="discord-webhook"
                    value={webhook}
                    onChange={(e) => setWebhook(e.target.value)}
                    placeholder={
                      webhookSaved
                        ? "Saved on server — paste a new URL to replace"
                        : "https://discord.com/api/webhooks/…"
                    }
                    autoComplete="off"
                    disabled={!discordEnabled}
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!discordEnabled || saving || !webhook.trim()}
                    onClick={() => void saveWebhook()}
                  >
                    {saving ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      !discordEnabled ||
                      testing ||
                      (!webhook.trim() && !webhookSaved)
                    }
                    onClick={() => void testDiscord()}
                  >
                    {testing ? "Sending…" : "Test Discord"}
                  </Button>
                </div>
              </CardContent>
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
                      Admin → Email
                    </Link>
                    .
                  </CardDescription>
                </div>
                <Switch
                  checked={emailEnabled}
                  onCheckedChange={(checked) => {
                    if (checked && !smtpReady) {
                      setEmailEnabled(false);
                      toast.error(
                        "Set up Email (SMTP) before enabling this channel",
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
                    : "SMTP is not set up yet — configure Email before enabling."}
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
