"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Info, Mail } from "lucide-react";
import { ConnectionStatusIcon } from "@/components/connection-status-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import {
  applyEmailTemplate,
  type EmailTemplateBody,
  type EmailTemplateId,
  type EmailTemplatesMap,
} from "@/lib/email-templates";
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

type TemplateMeta = {
  id: EmailTemplateId;
  label: string;
  description: string;
  variables: { key: string; description: string }[];
};

function EmailTemplatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState<TemplateMeta[]>([]);
  const [defaults, setDefaults] = useState<EmailTemplatesMap | null>(null);
  const [samples, setSamples] = useState<
    Record<EmailTemplateId, Record<string, string>> | null
  >(null);
  const [drafts, setDrafts] = useState<EmailTemplatesMap | null>(null);
  const [activeId, setActiveId] = useState<EmailTemplateId>("invite");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch("/api/admin/email-templates", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Could not load templates");
        if (cancelled) return;
        setMeta(Array.isArray(data.meta) ? data.meta : []);
        setDefaults(data.defaults || null);
        setSamples(data.samples || null);
        setDrafts(data.templates || null);
        const first = data.meta?.[0]?.id as EmailTemplateId | undefined;
        if (first) setActiveId(first);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Load failed");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const active = drafts?.[activeId];
  const activeMeta = meta.find((m) => m.id === activeId);
  const sampleVars = samples?.[activeId] || {};

  const preview = useMemo(() => {
    if (!active) return { subject: "", html: "" };
    return {
      subject: applyEmailTemplate(active.subject, sampleVars),
      html: applyEmailTemplate(active.html, sampleVars),
    };
  }, [active, sampleVars]);

  function patchActive(partial: Partial<EmailTemplateBody>) {
    setDrafts((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [activeId]: { ...prev[activeId], ...partial },
      };
    });
  }

  function resetActive() {
    if (!defaults) return;
    setDrafts((prev) => {
      if (!prev) return prev;
      return { ...prev, [activeId]: { ...defaults[activeId] } };
    });
  }

  async function save() {
    if (!drafts) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/email-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: drafts }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Save failed");
        return;
      }
      if (data.templates) setDrafts(data.templates);
      toastSaved("Email templates saved");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,880px)] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 border-b border-border px-6 py-4 text-left">
          <DialogTitle>Email templates</DialogTitle>
          <DialogDescription>
            Edit subject and body for each outbound message. Use{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              {"{{variable}}"}
            </code>{" "}
            placeholders — include{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              {"{{logoUrl}}"}
            </code>{" "}
            for the Polarr icon. Preview uses sample values; sent mail embeds the
            logo and shows your server name as the From display name.
          </DialogDescription>
        </DialogHeader>

        {loading || !drafts ? (
          <p className="px-6 py-10 text-sm text-muted-foreground">
            {error || "Loading…"}
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[11rem_1fr]">
            <nav className="flex gap-1 overflow-x-auto border-b border-border p-3 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
              {meta.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setActiveId(m.id)}
                  className={cn(
                    "rounded-md px-3 py-2 text-left text-sm transition-colors",
                    activeId === m.id
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 space-y-4 overflow-y-auto p-4 sm:p-5">
              {activeMeta ? (
                <p className="text-sm text-muted-foreground">
                  {activeMeta.description}
                </p>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="tpl-subject">Subject</Label>
                <Input
                  id="tpl-subject"
                  value={active?.subject || ""}
                  onChange={(e) => patchActive({ subject: e.target.value })}
                  {...NO_PASSKEEPER}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tpl-html">HTML body</Label>
                <Textarea
                  id="tpl-html"
                  value={active?.html || ""}
                  onChange={(e) => patchActive({ html: e.target.value })}
                  className="min-h-[160px] font-mono text-xs leading-relaxed"
                  {...NO_PASSKEEPER}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tpl-text">Plain text</Label>
                <Textarea
                  id="tpl-text"
                  value={active?.text || ""}
                  onChange={(e) => patchActive({ text: e.target.value })}
                  className="min-h-[100px] font-mono text-xs leading-relaxed"
                  {...NO_PASSKEEPER}
                />
              </div>

              {activeMeta?.variables?.length ? (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Variables
                  </p>
                  <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {activeMeta.variables.map((v) => (
                      <li key={v.key}>
                        <code className="text-foreground/80">{`{{${v.key}}}`}</code>
                        <span className="ml-1 opacity-70">{v.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Preview
                </p>
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <span className="text-foreground/80">Subject:</span>{" "}
                    {preview.subject || "—"}
                  </div>
                  <iframe
                    title={`${activeId} email preview`}
                    sandbox=""
                    srcDoc={preview.html}
                    className="h-[220px] w-full bg-[#0f0f12]"
                  />
                </div>
              </div>

              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter className="border-t border-border px-6 py-4 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={!defaults || saving || loading}
            onClick={() => resetActive()}
          >
            Reset template
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || loading || !drafts}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save templates"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminEmailClient() {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");
  const [secure, setSecure] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [configured, setConfigured] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  /** Fingerprint of the last values that passed a connection test (or loaded saved config). */
  const [validatedKey, setValidatedKey] = useState<string | null>(null);
  const [baselineKey, setBaselineKey] = useState<string | null>(null);
  const [baselinePublicUrl, setBaselinePublicUrl] = useState<string | null>(
    null,
  );
  const [templatesOpen, setTemplatesOpen] = useState(false);

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
      const nextPublicUrl = typeof settings.publicUrl === "string"
        ? settings.publicUrl
        : "";
      const isConfigured = Boolean(settings.smtpConfigured);
      setHost(nextHost);
      setPort(nextPort);
      setUser(nextUser);
      setPassword(nextPassword);
      setFrom(nextFrom);
      setSecure(nextSecure);
      setPublicUrl(nextPublicUrl);
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
      setBaselinePublicUrl(nextPublicUrl.trim());
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
  const smtpDirty = baselineKey !== null && currentKey !== baselineKey;
  const publicUrlDirty =
    baselinePublicUrl !== null && publicUrl.trim() !== baselinePublicUrl;
  // Public URL alone can save without re-testing SMTP; SMTP edits still need a test.
  const canSave =
    (testPassed && smtpDirty) || (publicUrlDirty && !smtpDirty);
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
      publicUrl: publicUrl.trim().replace(/\/+$/, ""),
    };
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const body = smtpDirty
        ? formBody()
        : { publicUrl: publicUrl.trim().replace(/\/+$/, "") };
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      if (typeof data.settings?.publicUrl === "string") {
        setPublicUrl(data.settings.publicUrl);
        setBaselinePublicUrl(data.settings.publicUrl.trim());
      } else {
        setBaselinePublicUrl(publicUrl.trim());
      }
      if (smtpDirty) {
        setBaselineKey(currentKey);
        setValidatedKey(currentKey);
      }
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">SMTP</h1>
          <p className="text-sm text-muted-foreground">
            Outgoing mail for invite links and admin notifications on this
            server.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => setTemplatesOpen(true)}
        >
          <Mail className="size-3.5" />
          Templates
        </Button>
      </div>

      <EmailTemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
      />

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
            <div className="space-y-2">
              <Label htmlFor="polarr-public-url">Public URL</Label>
              <Input
                id="polarr-public-url"
                name="polarr-public-url"
                type="url"
                value={publicUrl}
                onChange={(e) => setPublicUrl(e.target.value)}
                placeholder="https://polarr.example.com"
                {...NO_PASSKEEPER}
              />
              <p className="text-xs text-muted-foreground">
                Base URL used in invite emails (join links and logo). Required
                when the app listens on 0.0.0.0 — use the address people can
                open in a browser (domain, Tailscale, or LAN IP).
              </p>
              {!publicUrl.trim() ? (
                <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    Without Public URL, invite emails may fail or use an
                    unreachable host.
                  </span>
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ConnectionStatusIcon
                ok={testPassed || (configured && !smtpDirty)}
                okLabel={
                  configured && !smtpDirty
                    ? "SMTP connected"
                    : "Test passed — ready to save"
                }
                badLabel={
                  smtpDirty
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
