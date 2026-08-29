"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { AUTH_CONTROL, AUTH_SUBMIT, AuthFieldGroup, AuthScreen } from "@/components/auth-screen";
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
export function LoginForm({
  discordLoginAvailable = false,
}: {
  discordLoginAvailable?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const flag = searchParams.get("discord");
    if (!flag) return;
    const messages: Record<string, string> = {
      denied: "Discord sign-in was cancelled",
      missing: "Discord sign-in was missing data — try again",
      config: "Discord sign-in isn’t configured on this server",
      state: "Discord sign-in expired — try again",
      token: "Couldn’t finish Discord sign-in",
      nolink:
        "No Polarr account is linked to that Discord. Sign in with your password, then link Discord in Settings.",
      banned: "This account is banned",
      auth: "Couldn’t sign in with Discord",
      rate: "Too many attempts — try again shortly",
    };
    const text = messages[flag];
    if (text) toastError(text);
    router.replace("/login", { scroll: false });
  }, [searchParams, router]);

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

  async function signInWithDiscord() {
    setDiscordBusy(true);
    try {
      const res = await fetch("/api/discord/login");
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.url !== "string") {
        toastError(
          typeof data.error === "string"
            ? data.error
            : "Discord sign-in isn’t available",
        );
        return;
      }
      window.location.href = data.url;
    } catch {
      toastError("Could not reach the server");
      setDiscordBusy(false);
    }
  }

  return (
    <AuthScreen title="Polarr">
      {mounted ? (
        <form className="flex flex-col" onSubmit={(e) => void onSubmit(e)}>
          <AuthFieldGroup>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              aria-label="Username"
              placeholder="Username"
              className={AUTH_CONTROL}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              minLength={MIN_PASSWORD_LENGTH}
              aria-label="Password"
              placeholder="Password"
              className={AUTH_CONTROL}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </AuthFieldGroup>
          <Button
            type="submit"
            className={AUTH_SUBMIT}
            disabled={submitting || discordBusy}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
          {discordLoginAvailable ? (
            <Button
              type="button"
              variant="ghost"
              className="mt-2 h-12 w-full gap-2 text-[15px] text-muted-foreground"
              disabled={discordBusy || submitting}
              onClick={() => void signInWithDiscord()}
            >
              <DiscordGlyph className="size-4 shrink-0" />
              {discordBusy ? "…" : "Continue with Discord"}
            </Button>
          ) : null}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-[15px] text-muted-foreground">
            <a href="/join">Join with a code</a>
            <Link href="/forgot-password">Forgot password?</Link>
          </div>
        </form>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white/[0.06]" aria-hidden>
          <div className="h-14" />
          <div className="mx-4 h-px bg-border" />
          <div className="h-14" />
        </div>
      )}
    </AuthScreen>
  );
}

function DiscordGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M20.317 4.37a19.8 19.8 0 0 0-4.885-1.515.07.07 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.3 18.3 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.08.08 0 0 0-.079-.037A19.7 19.7 0 0 0 3.677 4.37a.09.09 0 0 0-.04.04C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.08.08 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.373-.292a.07.07 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.07.07 0 0 1 .079.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.08.08 0 0 0 .084.028 19.8 19.8 0 0 0 6.002-3.03.08.08 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.041-.029ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  );
}
