"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { getOrCreateDeviceId } from "@/lib/device-id";
import { toastError, toastSuccess } from "@/lib/toast";

export function JoinForm({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [code, setCode] = useState(initialCode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) {
      toastError("Enter an invite code");
      return;
    }
    if (!username.trim()) {
      toastError("Enter a username");
      return;
    }
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
      const res = await fetch("/api/auth/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          username: username.trim(),
          password,
          confirmPassword,
          hwid: getOrCreateDeviceId() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(
          typeof data.error === "string" ? data.error : "Could not join",
        );
        return;
      }
      toastSuccess("Welcome to Polarr");
      router.replace("/");
      router.refresh();
    } catch {
      toastError("Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen title="Join" description="Create an account with an invite code.">
      {mounted ? (
        <form className="flex flex-col" onSubmit={(e) => void onSubmit(e)}>
          <AuthFieldGroup>
            <Input
              id="code"
              autoComplete="off"
              autoFocus={!initialCode}
              aria-label="Invite code"
              placeholder="Invite code"
              className={AUTH_CONTROL}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus={Boolean(initialCode)}
              aria-label="Username"
              placeholder="Username"
              className={AUTH_CONTROL}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              aria-label="Password"
              placeholder="Password"
              className={AUTH_CONTROL}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordInput
              id="confirm"
              name="confirm"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              aria-label="Confirm password"
              placeholder="Confirm password"
              className={AUTH_CONTROL}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </AuthFieldGroup>
          <p className="mt-2 px-1 text-[13px] text-muted-foreground">
            At least {MIN_PASSWORD_LENGTH} characters
          </p>
          <Button type="submit" className={AUTH_SUBMIT} disabled={submitting}>
            {submitting ? "Creating…" : "Create account"}
          </Button>
          <p className="mt-8 text-center text-[15px] text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login">Sign in</Link>
          </p>
        </form>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white/[0.06]" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              {i > 0 ? <div className="mx-4 h-px bg-border" /> : null}
              <div className="h-14" />
            </div>
          ))}
        </div>
      )}
    </AuthScreen>
  );
}
