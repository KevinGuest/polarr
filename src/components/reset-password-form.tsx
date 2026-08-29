"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import {
  AUTH_CONTROL,
  AUTH_SUBMIT,
  AuthFieldGroup,
  AuthScreen,
} from "@/components/auth-screen";
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
    <AuthScreen title="New password" description="Pick a new password for your account.">
      {tokenState === "checking" ? (
        <p className="py-6 text-center text-[15px] text-muted-foreground">
          Checking link…
        </p>
      ) : tokenState === "bad" ? (
        <div className="flex flex-col">
          <p className="text-center text-[15px] leading-snug text-muted-foreground">
            This reset link is invalid or has expired.
          </p>
          <Button asChild className={AUTH_SUBMIT}>
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
          <p className="mt-8 text-center text-[15px] text-muted-foreground">
            <Link href="/login">Back to sign in</Link>
          </p>
        </div>
      ) : !mounted ? (
        <div className="overflow-hidden rounded-2xl bg-white/[0.06]" aria-hidden>
          <div className="h-14" />
          <div className="mx-4 h-px bg-border" />
          <div className="h-14" />
        </div>
      ) : (
        <form className="flex flex-col" onSubmit={(e) => void onSubmit(e)}>
          <AuthFieldGroup>
            <PasswordInput
              id="new-password"
              name="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              autoFocus
              aria-label="New password"
              placeholder="New password"
              className={AUTH_CONTROL}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordInput
              id="confirm-password"
              name="confirmPassword"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              aria-label="Confirm password"
              placeholder="Confirm password"
              className={AUTH_CONTROL}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </AuthFieldGroup>
          <Button type="submit" className={AUTH_SUBMIT} disabled={submitting}>
            {submitting ? "Saving…" : "Update password"}
          </Button>
        </form>
      )}
    </AuthScreen>
  );
}
