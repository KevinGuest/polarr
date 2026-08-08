"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Card, CardContent } from "@/components/ui/card";
import {
  isPasswordLongEnough,
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_SHORT_MSG,
} from "@/lib/auth-password";
import { getOrCreateDeviceId } from "@/lib/device-id";
import { toastError } from "@/lib/toast";

/**
 * Login fields mount after hydration so password managers (e.g. Proton Pass)
 * injecting controls don’t mismatch SSR HTML.
 */
export function LoginForm() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      toastError("Enter your username");
      return;
    }
    if (!password) {
      toastError("Enter your password");
      return;
    }
    if (!isPasswordLongEnough(password)) {
      toastError(PASSWORD_TOO_SHORT_MSG);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          hwid: getOrCreateDeviceId() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.banned) {
          toastError(
            typeof data.error === "string"
              ? data.error
              : data.permanent
                ? "You’re permanently banned."
                : "You’re banned.",
          );
          return;
        }
        toastError(
          typeof data.error === "string" ? data.error : "Login failed",
        );
        return;
      }
      router.replace("/");
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
        <h1 className="text-3xl font-semibold tracking-tight">Polarr</h1>
        <p className="mt-2 text-muted-foreground">
          Sign in to your homeserver music hub.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {mounted ? (
            <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          ) : (
            <div className="space-y-4" aria-hidden>
              <div className="space-y-2">
                <div className="h-4 w-16 rounded bg-muted/50" />
                <div className="h-10 rounded-md border border-border bg-background" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-16 rounded bg-muted/50" />
                <div className="h-10 rounded-md border border-border bg-background" />
              </div>
              <div className="h-10 w-full rounded-md bg-muted/40" />
            </div>
          )}
          <p className="text-center text-xs text-muted-foreground">
            Have an invite?{" "}
            <a href="/join" className="underline underline-offset-2">
              Join with a code
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
