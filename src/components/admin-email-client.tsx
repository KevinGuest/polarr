"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
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

export function AdminEmailClient() {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");
  const [secure, setSecure] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
      setHost(settings.smtpHost || "");
      setPort(String(settings.smtpPort || 587));
      setUser(settings.smtpUser || "");
      setPassword(settings.smtpPassword || "");
      setFrom(settings.smtpFrom || "");
      setSecure(Boolean(settings.smtpSecure));
      setConfigured(Boolean(settings.smtpConfigured));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    const portNum = Number.parseInt(port, 10);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        smtpHost: host.trim(),
        smtpPort: Number.isFinite(portNum) ? portNum : 587,
        smtpUser: user.trim(),
        smtpPassword: password,
        smtpFrom: from.trim(),
        smtpSecure: secure,
      }),
    });
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      setSaving(false);
      return;
    }
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMessage(
        typeof data.error === "string"
          ? data.error
          : "Save failed — check the form fields",
      );
      return;
    }
    setConfigured(Boolean(data.settings?.smtpConfigured));
    if (data.settings?.smtpPassword) setPassword(data.settings.smtpPassword);
    setMessage("Saved");
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Email</h1>
        <p className="text-sm text-muted-foreground">
          Admin only. Sign in with an admin account to configure SMTP.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Email
        </h1>
        <p className="text-sm text-muted-foreground">
          SMTP for mailing invite links when people join this server.
        </p>
      </div>

      <div className="rounded-xl border border-border px-4 py-4">
        <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Status
        </div>
        <div className="mt-2 text-sm font-semibold">
          {configured ? "Configured" : "Not configured"}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>SMTP</CardTitle>
            <CardDescription>
              Host, port, and from address are required. Use TLS/SSL when your
              provider expects it (often port 465).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="smtp-host">Host</Label>
              <Input
                id="smtp-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="smtp.example.com"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="smtp-port">Port</Label>
                <Input
                  id="smtp-port"
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="587"
                />
              </div>
              <div className="space-y-2">
                <span
                  className="block text-sm font-medium leading-none opacity-0 select-none"
                  aria-hidden
                >
                  Port
                </span>
                <div className="flex h-10 items-center justify-between gap-3 rounded-md border border-border bg-background px-3">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="smtp-secure" className="cursor-pointer">
                      TLS / SSL
                    </Label>
                    <span className="group relative inline-flex">
                      <button
                        type="button"
                        className="inline-flex size-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Secure connection"
                        title="Secure connection"
                      >
                        <Info className="size-3.5" strokeWidth={2} />
                      </button>
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                      >
                        Secure connection
                      </span>
                    </span>
                  </div>
                  <Switch
                    id="smtp-secure"
                    checked={secure}
                    onCheckedChange={setSecure}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-user">Username</Label>
              <Input
                id="smtp-user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-password">Password</Label>
              <Input
                id="smtp-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-from">From address</Label>
              <Input
                id="smtp-from"
                type="email"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="polarr@example.com"
              />
            </div>
            {message ? (
              <p className="text-sm text-foreground">{message}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/invites">Open invites</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
