"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Card, CardContent } from "@/components/ui/card";
import {
  isPasswordLongEnough,
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_SHORT_MSG,
} from "@/lib/auth-password";
import { toastError, toastSuccess } from "@/lib/toast";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") || "").trim();
  const [mounted, setMounted] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tokenState, setTokenState] = useState<"checking" | "ok" | "bad">(
    "checking",
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!token) {
      setTokenState("bad");
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/auth/reset-password?token=${encodeURIComponent(token)}`,
    )
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setTokenState(data.valid ? "ok" : "bad");
      })
      .catch(() => {
        if (!cancelled) setTokenState("bad");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isPasswordLongEnough(password)) {
      toastError(PASSWORD_TOO_SHORT_MSG);
      return;
    }
    if (password !== confirmPassword) {
      toastError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password,
          confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string"
            ? data.error
            : "Couldn’t reset password",
        );
        return;
      }
      toastSuccess("Password updated — sign in");
      router.replace("/login");
      router.refresh();
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
          New password
        </h1>
        <p className="mt-2 text-muted-foreground">
          Pick a new password for your Polarr account.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {tokenState === "checking" ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Checking link…
            </p>
          ) : tokenState === "bad" ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                This reset link is invalid or has expired.
              </p>
              <Button asChild className="w-full">
                <Link href="/forgot-password">Request a new link</Link>
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                <Link href="/login" className="underline underline-offset-2">
                  Back to sign in
                </Link>
              </p>
            </div>
          ) : !mounted ? (
            <div className="space-y-4" aria-hidden>
              <div className="space-y-2">
                <div className="h-4 w-24 rounded bg-muted/50" />
                <div className="h-10 rounded-md border border-border bg-background" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-28 rounded bg-muted/50" />
                <div className="h-10 rounded-md border border-border bg-background" />
              </div>
              <div className="h-10 w-full rounded-md bg-muted/40" />
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <PasswordInput
                  id="new-password"
                  name="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <PasswordInput
                  id="confirm-password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Saving…" : "Update password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
