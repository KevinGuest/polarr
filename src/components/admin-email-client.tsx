"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Info } from "lucide-react";
import { ConnectionStatusIcon } from "@/components/connection-status-icon";
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
import { toastError, toastSaved } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Keeps 1Password / Bitwarden / browser autofill off non-login admin fields. */
const NO_PASSKEEPER = {
  autoComplete: "off" as const,
  autoCorrect: "off" as const,
  autoCapitalize: "off" as const,
  spellCheck: false as const,
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
};

function formKey(parts: Record<string, string | number | boolean>) {
  return JSON.stringify(parts);
}

export function AdminEmailClient() {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");
  const [secure, setSecure] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  /** Fingerprint of the last values that passed a connection test (or loaded saved config). */
  const [validatedKey, setValidatedKey] = useState<string | null>(null);
  const [baselineKey, setBaselineKey] = useState<string | null>(null);

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
      const nextHost = settings.smtpHost || "";
      const nextPort = String(settings.smtpPort || 587);
      const nextUser = settings.smtpUser || "";
      const nextPassword = settings.smtpPassword || "";
      const nextFrom = settings.smtpFrom || "";
      const nextSecure = Boolean(settings.smtpSecure);
      const isConfigured = Boolean(settings.smtpConfigured);
      setHost(nextHost);
      setPort(nextPort);
      setUser(nextUser);
      setPassword(nextPassword);
      setFrom(nextFrom);
      setSecure(nextSecure);
      setConfigured(isConfigured);
      const key = formKey({
        host: nextHost.trim(),
        port: nextPort,
        user: nextUser.trim(),
        password: nextPassword,
        from: nextFrom.trim(),
        secure: nextSecure,
      });
      setBaselineKey(key);
      // Already set up and working when last saved — treat as tested until edits.
      setValidatedKey(isConfigured ? key : null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentKey = useMemo(
    () =>
      formKey({
        host: host.trim(),
        port,
        user: user.trim(),
        password,
        from: from.trim(),
        secure,
      }),
    [host, port, user, password, from, secure],
  );

  const testPassed = validatedKey !== null && validatedKey === currentKey;
  const dirty = baselineKey !== null && currentKey !== baselineKey;
  const canSave = testPassed && dirty;
  const hasTestableFields = Boolean(host.trim() && from.trim());
  const canTest = hasTestableFields && !testPassed;

  function formBody() {
    const portNum = Number.parseInt(port, 10);
    return {
      smtpHost: host.trim(),
      smtpPort: Number.isFinite(portNum) ? portNum : 587,
      smtpUser: user.trim(),
      smtpPassword: password,
      smtpFrom: from.trim(),
      smtpSecure: secure,
    };
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formBody()),
      });
      if (res.status === 403 || res.status === 401) {
        setForbidden(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        toastError(
          typeof data.error === "string"
            ? data.error
            : "Save failed — check the form fields",
        );
        return;
      }
      setConfigured(Boolean(data.settings?.smtpConfigured));
      if (data.settings?.smtpPassword) setPassword(data.settings.smtpPassword);
      setBaselineKey(currentKey);
      setValidatedKey(currentKey);
      toastSaved();
    } finally {
      setSaving(false);
    }
  }

  async function testSmtp() {
    setTesting(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formBody(), testSmtp: true }),
      });
      if (res.status === 403 || res.status === 401) {
        setForbidden(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setValidatedKey(null);
        toastError(
          typeof data.error === "string" ? data.error : "SMTP test failed",
        );
        return;
      }
      setValidatedKey(currentKey);
      toastSaved(
        typeof data.to === "string"
          ? `Test email sent to ${data.to}`
          : "Test email sent",
      );
    } finally {
      setTesting(false);
    }
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">SMTP</h1>
        <p className="text-sm text-muted-foreground">
          Admin only. Sign in with an admin account to configure outgoing mail.
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
        <h1 className="text-2xl font-semibold tracking-tight">SMTP</h1>
        <p className="text-sm text-muted-foreground">
          Outgoing mail for invite links and admin notifications on this server.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
            <CardDescription>
              Host, port, and from address are required. Use TLS/SSL when your
              provider expects it (often port 465). Test sends a message to the
              Server Owner&apos;s account email. Save unlocks after a successful
              test.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="polarr-smtp-host">Host</Label>
              <Input
                id="polarr-smtp-host"
                name="polarr-smtp-host"
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="smtp.example.com"
                {...NO_PASSKEEPER}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="polarr-smtp-port">Port</Label>
                <Input
                  id="polarr-smtp-port"
                  name="polarr-smtp-port"
                  type="text"
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="587"
                  {...NO_PASSKEEPER}
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
              <Label htmlFor="polarr-smtp-user">Username</Label>
              <Input
                id="polarr-smtp-user"
                name="polarr-smtp-user"
                type="text"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                {...NO_PASSKEEPER}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="polarr-smtp-pass">Password</Label>
              <div className="relative">
                {/* text + CSS discs — not type=password — so passkeepers skip this */}
                <Input
                  id="polarr-smtp-pass"
                  name="polarr-smtp-pass"
                  type="text"
                  inputMode="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={cn(
                    "pr-10",
                    !showPassword &&
                      "[-webkit-text-security:disc] [text-security:disc]",
                  )}
                  {...NO_PASSKEEPER}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showPassword ? "Hide" : "Show"}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="polarr-smtp-from">From address</Label>
              <Input
                id="polarr-smtp-from"
                name="polarr-smtp-from"
                type="text"
                inputMode="email"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="polarr@example.com"
                {...NO_PASSKEEPER}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ConnectionStatusIcon
                ok={testPassed || (configured && !dirty)}
                okLabel={
                  configured && !dirty
                    ? "SMTP connected"
                    : "Test passed — ready to save"
                }
                badLabel={
                  dirty
                    ? "Test connection after changes before saving"
                    : "SMTP not set up"
                }
              />
              {canTest || testing ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving || testing}
                  onClick={() => void testSmtp()}
                >
                  {testing ? "Sending…" : "Test connection"}
                </Button>
              ) : null}
              <Button
                disabled={saving || testing || !canSave}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
