"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      </div>

      <Card>
        {step === "account" ? (
          <CardContent className="space-y-4 pt-6">
            <form className="space-y-4" onSubmit={(e) => void onCreateAccount(e)}>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  At least {MIN_PASSWORD_LENGTH} characters
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <PasswordInput
                  id="confirmPassword"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              <Button type="submit" className="w-full" disabled={!canCreateAccount}>
                {loading ? "Creating…" : "Continue"}
              </Button>
            </form>
          </CardContent>
        ) : null}

        {step === "lidarr" ? (
          <>
            <CardHeader>
              <CardTitle>Lidarr</CardTitle>
              <CardDescription>
                Point Polarr at Lidarr for your library. You can skip and set
                this up later under Admin.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="lidarr-url">Lidarr URL</Label>
                <Input
                  id="lidarr-url"
                  value={lidarrUrl}
                  onChange={(e) => setLidarrUrl(e.target.value)}
                  placeholder="http://localhost:8686"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lidarr-key">API key</Label>
                <Input
                  id="lidarr-key"
                  value={lidarrApiKey}
                  onChange={(e) => setLidarrApiKey(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="music-root">Music root path</Label>
                <Input
                  id="music-root"
                  value={musicRoot}
                  onChange={(e) => setMusicRoot(e.target.value)}
                  placeholder="./music"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  disabled={loading}
                  onClick={() => void saveLidarr(true)}
                >
                  {loading ? "Saving…" : "Save & continue"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loading || !lidarrUrl.trim()}
                  onClick={() => void testLidarr()}
                >
                  Test connection
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={loading}
                  onClick={() => setStep("email")}
                >
                  Skip for now
                </Button>
              </div>
            </CardContent>
          </>
        ) : null}

        {step === "email" ? (
          <>
            <CardHeader>
              <CardTitle>SMTP</CardTitle>
              <CardDescription>
                SMTP for invites and notifications. Skip if you’ll configure it
                later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="smtp-host">SMTP host</Label>
                <Input
                  id="smtp-host"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.example.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="smtp-port">Port</Label>
                  <Input
                    id="smtp-port"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    placeholder="587"
                  />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <Switch
                    id="smtp-secure"
                    checked={smtpSecure}
                    onCheckedChange={setSmtpSecure}
                  />
                  <Label htmlFor="smtp-secure">TLS / SSL</Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-user">Username</Label>
                <Input
                  id="smtp-user"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-password">Password</Label>
                <PasswordInput
                  id="smtp-password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-from">From address</Label>
                <Input
                  id="smtp-from"
                  type="email"
                  value={smtpFrom}
                  onChange={(e) => setSmtpFrom(e.target.value)}
                  placeholder="polarr@example.com"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  disabled={loading}
                  onClick={() => void saveEmail(true)}
                >
                  {loading ? "Saving…" : "Save & finish"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={loading}
                  onClick={() => finish()}
                >
                  Skip for now
                </Button>
              </div>
            </CardContent>
          </>
        ) : null}
      </Card>
    </div>
  );
}
