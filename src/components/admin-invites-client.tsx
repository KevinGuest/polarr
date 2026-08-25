"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  MoreHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buildInviteEmail } from "@/lib/invite-email";
import { toastError, toastSuccess } from "@/lib/toast";

const PAGE_SIZE = 5;

type InviteRow = {
  id: string;
  code: string;
  createdByUsername?: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  usedByUsername?: string | null;
  usedByPublicId?: string | null;
  usedAt: string | null;
  emailedTo?: string | null;
  status: "open" | "used" | "revoked" | "expired";
};

export function AdminInvitesClient() {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [serverName, setServerName] = useState("Polarr");
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  async function refresh() {
    const res = await fetch("/api/admin/invites");
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    setForbidden(false);
    const data = await res.json();
    setInvites(data.invites || []);
    setEmailConfigured(Boolean(data.emailConfigured));
    setServerName(data.serverName || "Polarr");
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const pageCount = Math.max(1, Math.ceil(invites.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageInvites = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return invites.slice(start, start + PAGE_SIZE);
  }, [invites, safePage]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  const sample = useMemo(() => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://polarr.local";
    const code = "POLARR-SAMPLE-CODE";
    const expiresAt = new Date(
      Date.now() + 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    return buildInviteEmail({
      to: email.trim() || "friend@example.com",
      code,
      joinUrl: `${origin}/join?code=${encodeURIComponent(code)}`,
      serverName,
      invitedBy: "you",
      expiresAt,
      from: "polarr@example.com",
    });
  }, [email, serverName]);

  async function sendInvite() {
    setCreating(true);
    setDialogError(null);
    const res = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), expiresInDays: 14 }),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) {
      setDialogError(data.error || "Could not send invite");
      return;
    }
    setDialogOpen(false);
    setEmail("");
    setShowPreview(false);
    setPage(0);
    toastSuccess(`Invite emailed to ${data.emailedTo || email.trim()}`);
    void refresh();
  }

  async function revoke(id: string) {
    setBusy(id);
    const res = await fetch("/api/admin/invites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      toastError(data?.error || "Revoke failed");
      return;
    }
    toastSuccess("Invite revoked");
    void refresh();
  }

  async function resend(inv: InviteRow) {
    if (!inv.emailedTo?.trim()) {
      toastError("This invite has no email address to resend to");
      return;
    }
    setBusy(inv.id);
    const res = await fetch("/api/admin/invites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: inv.id, action: "resend" }),
    });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      toastError(data?.error || "Resend failed");
      return;
    }
    toastSuccess(`Invite resent to ${data?.emailedTo || inv.emailedTo}`);
  }

  async function copyLink(code: string) {
    const url = `${window.location.origin}/join?code=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess("Link copied");
    } catch {
      toastError("Could not copy link");
    }
  }

  if (forbidden) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Invites</h1>
        <p className="text-sm text-muted-foreground">
          Admin only. Sign in with an admin account to manage invites.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Invites
          </h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : emailConfigured
                ? "Single-use invite codes for others to join your Polarr server."
                : "Invites are disabled until SMTP is configured"}
          </p>
        </div>
        {emailConfigured ? (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            New invite
          </Button>
        ) : (
          <Button asChild size="sm">
            <Link href="/admin/email">Configure</Link>
          </Button>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Codes</h2>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {emailConfigured
              ? "No invites yet. Send one to get started."
              : "Configure email to start inviting people."}
          </p>
        ) : (
          <>
            <ul className="space-y-3">
              {pageInvites.map((inv) => (
                <li
                  key={inv.id}
                  className="rounded-xl border border-border px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-sm font-medium tracking-wide">
                          {inv.code}
                        </code>
                        <Badge
                          variant={
                            inv.status === "open"
                              ? "success"
                              : inv.status === "used"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {inv.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Created {new Date(inv.createdAt).toLocaleString()}
                        {inv.createdByUsername
                          ? ` by ${inv.createdByUsername}`
                          : ""}
                        {inv.emailedTo ? ` · emailed ${inv.emailedTo}` : ""}
                        {inv.expiresAt
                          ? ` · expires ${new Date(inv.expiresAt).toLocaleDateString()}`
                          : ""}
                        {inv.usedByUsername
                          ? ` · used by ${inv.usedByUsername}`
                          : ""}
                      </p>
                    </div>
                    {inv.status === "open" ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-9 shrink-0"
                            disabled={busy === inv.id}
                            aria-label={`Actions for invite ${inv.code}`}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            onSelect={() => void copyLink(inv.code)}
                          >
                            Copy link
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={
                              busy === inv.id || !inv.emailedTo?.trim()
                            }
                            onSelect={() => void resend(inv)}
                          >
                            Resend
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            disabled={busy === inv.id}
                            onSelect={() => void revoke(inv.id)}
                          >
                            Revoke
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : inv.status === "used" && inv.usedByPublicId ? (
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/admin/users?user=${encodeURIComponent(inv.usedByPublicId)}`}
                        >
                          View user
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {invites.length > PAGE_SIZE ? (
              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-muted-foreground">
                  {safePage * PAGE_SIZE + 1}–
                  {Math.min((safePage + 1) * PAGE_SIZE, invites.length)} of{" "}
                  {invites.length}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    disabled={safePage <= 0}
                    aria-label="Previous page"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-muted-foreground">
                    {safePage + 1} / {pageCount}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    disabled={safePage >= pageCount - 1}
                    aria-label="Next page"
                    onClick={() =>
                      setPage((p) => Math.min(pageCount - 1, p + 1))
                    }
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setDialogError(null);
            setShowPreview(false);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New invite</DialogTitle>
            <DialogDescription>
              Enter an email address. We’ll create a single-use code and send
              the join link.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="friend@example.com"
              />
            </div>

            <div className="space-y-2">
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowPreview((v) => !v)}
              >
                {showPreview ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
                {showPreview ? "Hide email sample" : "Show email sample"}
              </button>
              {showPreview ? (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="space-y-1 border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <p>
                      <span className="text-foreground/80">Subject:</span>{" "}
                      {sample.subject}
                    </p>
                    <p>
                      <span className="text-foreground/80">To:</span>{" "}
                      {email.trim() || "friend@example.com"}
                    </p>
                  </div>
                  <iframe
                    title="Invite email sample"
                    sandbox=""
                    srcDoc={sample.html}
                    className="h-[280px] w-full bg-[#0f0f12]"
                  />
                </div>
              ) : null}
            </div>

            {dialogError ? (
              <p className="text-sm text-destructive">{dialogError}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              disabled={creating || !email.trim()}
              onClick={() => void sendInvite()}
            >
              {creating ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
