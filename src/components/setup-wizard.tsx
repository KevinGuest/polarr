"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import {
  AUTH_CONTROL,
  AUTH_GHOST,
  AUTH_SUBMIT,
  AuthFieldGroup,
} from "@/components/auth-screen";
import { cn } from "@/lib/utils";
import {
  isPasswordLongEnough,
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_SHORT_MSG,
} from "@/lib/auth-password";
import { getOrCreateDeviceId } from "@/lib/device-id";
import { toastError, toastSuccess, toastSaved } from "@/lib/toast";

type Step = "account" | "lidarr" | "email";

const STEPS: Step[] = ["account", "lidarr", "email"];

export function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("account");

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [lidarrUrl, setLidarrUrl] = useState("");
  const [lidarrApiKey, setLidarrApiKey] = useState("");
  const [musicRoot, setMusicRoot] = useState("");

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(false);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetch("/api/status")
      .then((r) => r.json())
      .then((data: { setupComplete: boolean; hasUsers: boolean }) => {
        if (data.setupComplete && data.hasUsers) router.replace("/login");
      });
  }, [router]);

  function finish() {
    router.replace("/");
    router.refresh();
  }

  async function onCreateAccount(e: React.FormEvent) {
    e.preventDefault();

    if (!username.trim()) {
      toastError("Enter a username");
      return;
    }
    if (!email.trim()) {
      toastError("Email is required");
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

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          password,
          confirmPassword,
          hwid: getOrCreateDeviceId() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toastError(
          typeof data.error === "string" ? data.error : "Registration failed",
        );
        return;
      }

      toastSuccess("Admin account created");
      setStep("lidarr");
    } catch {
      toastError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }

  async function saveLidarr(andContinue: boolean) {
    setLoading(true);
    try {
      if (lidarrUrl.trim() || lidarrApiKey.trim() || musicRoot.trim()) {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lidarrUrl: lidarrUrl.trim(),
            lidarrApiKey: lidarrApiKey.trim(),
            musicRoot: musicRoot.trim(),
            fallbackEnabled: true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toastError(
            typeof data.error === "string"
              ? data.error
              : "Could not save Lidarr settings",
          );
          return;
        }
        toastSaved("Lidarr settings saved");
      }
      if (andContinue) setStep("email");
    } catch {
      toastError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }

  async function testLidarr() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testLidarr: true,
          lidarrUrl: lidarrUrl.trim(),
          lidarrApiKey: lidarrApiKey.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        toastSuccess(
          data.status?.version
            ? `Connected · Lidarr v${data.status.version}`
            : "Lidarr connection OK",
        );
      } else {
        toastError(
          typeof data.error === "string" ? data.error : "Connection failed",
        );
      }
    } catch {
      toastError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }

  async function saveEmail(andFinish: boolean) {
    setLoading(true);
    try {
      if (smtpHost.trim() || smtpFrom.trim()) {
        const portNum = Number.parseInt(smtpPort, 10);
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            smtpHost: smtpHost.trim(),
            smtpPort: Number.isFinite(portNum) ? portNum : 587,
            smtpUser: smtpUser.trim(),
            smtpPassword,
            smtpFrom: smtpFrom.trim(),
            smtpSecure,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toastError(
            typeof data.error === "string"
              ? data.error
              : "Could not save SMTP settings",
          );
          return;
        }
        toastSaved("SMTP settings saved");
      }
      if (andFinish) finish();
    } catch {
      toastError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }

  const canCreateAccount =
    username.trim().length >= 1 &&
    email.trim().length >= 3 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    confirmPassword.length >= MIN_PASSWORD_LENGTH &&
    !loading;

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="mx-auto flex w-full max-w-[22.5rem] flex-1 flex-col justify-center max-lg:max-w-none">
      <header className="mb-10 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/polarr-icon.png"
          alt=""
          aria-hidden
          className="mx-auto mb-6 size-[4.5rem] rounded-[1.35rem] object-cover"
        />
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Polarr</h1>
        <p className="mx-auto mt-2 max-w-[18rem] text-[15px] leading-snug text-muted-foreground">
          {step === "account"
            ? "Create the admin account to get started."
            : step === "lidarr"
              ? "Connect Lidarr for catalog and downloads."
              : "Optional SMTP for invites and notices."}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cn(
                "h-1.5 w-8 rounded-full transition-colors",
                i <= stepIndex ? "bg-foreground" : "bg-border",
              )}
              aria-hidden
            />
          ))}
        </div>
      </header>

      {step === "account" ? (
        <form className="flex flex-col" onSubmit={(e) => void onCreateAccount(e)}>
          <AuthFieldGroup>
            <Input
              id="username"
              autoComplete="username"
              autoFocus
              aria-label="Username"
              placeholder="Username"
              className={AUTH_CONTROL}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              aria-label="Email"
              placeholder="Email"
              className={AUTH_CONTROL}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <PasswordInput
              id="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              aria-label="Password"
              placeholder="Password"
              className={AUTH_CONTROL}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordInput
              id="confirmPassword"
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
          <Button type="submit" className={AUTH_SUBMIT} disabled={!canCreateAccount}>
            {loading ? "Creating…" : "Continue"}
          </Button>
        </form>
      ) : null}

      {step === "lidarr" ? (
        <div className="flex flex-col">
          <AuthFieldGroup>
            <Input
              id="lidarr-url"
              aria-label="Lidarr URL"
              placeholder="Lidarr URL"
              className={AUTH_CONTROL}
              value={lidarrUrl}
              onChange={(e) => setLidarrUrl(e.target.value)}
            />
            <Input
              id="lidarr-key"
              aria-label="API key"
              placeholder="API key"
              className={AUTH_CONTROL}
              value={lidarrApiKey}
              onChange={(e) => setLidarrApiKey(e.target.value)}
              autoComplete="off"
            />
            <Input
              id="music-root"
              aria-label="Music root path"
              placeholder="Music root path"
              className={AUTH_CONTROL}
              value={musicRoot}
              onChange={(e) => setMusicRoot(e.target.value)}
            />
          </AuthFieldGroup>
          <Button
            type="button"
            className={AUTH_SUBMIT}
            disabled={loading}
            onClick={() => void saveLidarr(true)}
          >
            {loading ? "Saving…" : "Save & continue"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={AUTH_GHOST}
            disabled={loading || !lidarrUrl.trim()}
            onClick={() => void testLidarr()}
          >
            Test connection
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={AUTH_GHOST}
            disabled={loading}
            onClick={() => setStep("email")}
          >
            Skip for now
          </Button>
        </div>
      ) : null}

      {step === "email" ? (
        <div className="flex flex-col">
          <AuthFieldGroup>
            <Input
              id="smtp-host"
              aria-label="SMTP host"
              placeholder="SMTP host"
              className={AUTH_CONTROL}
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
            />
            <Input
              id="smtp-port"
              aria-label="Port"
              placeholder="Port"
              className={AUTH_CONTROL}
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
            />
            <div className="flex h-14 items-center justify-between px-4">
              <Label htmlFor="smtp-secure" className="text-[17px] font-normal">
                TLS / SSL
              </Label>
              <Switch
                id="smtp-secure"
                checked={smtpSecure}
                onCheckedChange={setSmtpSecure}
              />
            </div>
            <Input
              id="smtp-user"
              aria-label="Username"
              placeholder="Username"
              className={AUTH_CONTROL}
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              autoComplete="off"
            />
            <PasswordInput
              id="smtp-password"
              aria-label="Password"
              placeholder="Password"
              className={AUTH_CONTROL}
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              autoComplete="new-password"
            />
            <Input
              id="smtp-from"
              type="email"
              aria-label="From address"
              placeholder="From address"
              className={AUTH_CONTROL}
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
            />
          </AuthFieldGroup>
          <Button
            type="button"
            className={AUTH_SUBMIT}
            disabled={loading}
            onClick={() => void saveEmail(true)}
          >
            {loading ? "Saving…" : "Save & finish"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={AUTH_GHOST}
            disabled={loading}
            onClick={() => finish()}
          >
            Skip for now
          </Button>
        </div>
      ) : null}
    </div>
  );
}
