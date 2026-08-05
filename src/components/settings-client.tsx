"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SettingsClient() {
  const [serverName, setServerName] = useState("Polarr");
  const [publicUrl, setPublicUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((settings) => {
        setServerName(settings.serverName || "Polarr");
        setPublicUrl(settings.publicUrl || "");
      })
      .catch(() => null);
  }, []);

  async function save() {
    setMessage(null);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverName,
        publicUrl,
      }),
    });
    const data = await res.json();
    setMessage(res.ok ? "Saved" : data.error || "Save failed");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          General homeserver display and client URL.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Server</CardTitle>
          <CardDescription>
            Lidarr, yt-dlp, and other connections are managed under Admin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Server name</Label>
            <Input
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Public URL (for mobile clients)</Label>
            <Input
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              placeholder="http://localhost:3000"
            />
          </div>
          {message ? (
            <p className="text-sm text-foreground">{message}</p>
          ) : null}
          <Button onClick={() => void save()}>Save</Button>
        </CardContent>
      </Card>
    </div>
  );
}
