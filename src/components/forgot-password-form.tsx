"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Form mounts after hydration so password managers (e.g. Proton Pass)
 * injecting controls don’t mismatch SSR HTML.
 */
export function ForgotPasswordForm() {
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toastError("Enter your email");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string"
            ? data.error
            : "Couldn’t send reset email",
        );
        return;
      }
      setSent(true);
      toastSuccess(
        typeof data.message === "string"
          ? data.message
          : "Check your email for a reset link",
      );
    } catch {
      toastError("Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/polarr-icon.png"
          alt=""
          aria-hidden
          className="mx-auto mb-4 size-14 rounded-xl object-cover"
        />
        <h1 className="text-3xl font-semibold tracking-tight">
          Forgot password
        </h1>
        <p className="mt-2 text-muted-foreground">
          Enter the email on your account and we’ll send a reset link.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {sent ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                If that email is on an account, the link is on its way. It
                expires in one hour.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </div>
          ) : mounted ? (
            <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Sending…" : "Send reset link"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                <Link href="/login" className="underline underline-offset-2">
                  Back to sign in
                </Link>
              </p>
            </form>
          ) : (
            <div className="space-y-4" aria-hidden>
              <div className="space-y-2">
                <div className="h-4 w-16 rounded bg-muted/50" />
                <div className="h-10 rounded-md border border-border bg-background" />
              </div>
              <div className="h-10 w-full rounded-md bg-muted/40" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
