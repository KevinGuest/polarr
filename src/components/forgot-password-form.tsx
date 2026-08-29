"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AUTH_CONTROL,
  AUTH_SUBMIT,
  AuthFieldGroup,
  AuthScreen,
} from "@/components/auth-screen";
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
    <AuthScreen
      title="Forgot password"
      description="Enter the email on your account and we’ll send a reset link."
    >
      {sent ? (
        <div className="flex flex-col">
          <p className="text-center text-[15px] leading-snug text-muted-foreground">
            If that email is on an account, the link is on its way. It expires
            in one hour.
          </p>
          <Button asChild className={AUTH_SUBMIT}>
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      ) : mounted ? (
        <form className="flex flex-col" onSubmit={(e) => void onSubmit(e)}>
          <AuthFieldGroup>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              aria-label="Email"
              placeholder="Email"
              className={AUTH_CONTROL}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </AuthFieldGroup>
          <Button type="submit" className={AUTH_SUBMIT} disabled={submitting}>
            {submitting ? "Sending…" : "Send reset link"}
          </Button>
          <p className="mt-8 text-center text-[15px] text-muted-foreground">
            <Link href="/login">Back to sign in</Link>
          </p>
        </form>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white/[0.06]" aria-hidden>
          <div className="h-14" />
        </div>
      )}
    </AuthScreen>
  );
}
