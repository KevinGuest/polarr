"use client";

import { useEffect, useState } from "react";
import { QRCodePlaceholder } from "@/components/qr-placeholder";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function MobileClient() {
  const [baseUrl, setBaseUrl] = useState("");
  const [serverName, setServerName] = useState("Polarr");

  useEffect(() => {
    setBaseUrl(window.location.origin);
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        setServerName(s.serverName || "Polarr");
        if (s.publicUrl) setBaseUrl(s.publicUrl);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mobile companion</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          The Polarr iOS app connects to this homeserver for browsing, streaming,
          and offline downloads. There is no cloud backend — your server is
          the catalog.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
            <CardDescription>
              Enter this URL in the iOS app, or use the deep-link form below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-border bg-background/50 px-3 py-3 font-mono text-sm">
              {baseUrl || "…"}
            </div>
            <p className="text-sm text-muted-foreground">Server: {serverName}</p>
            <p className="text-sm text-muted-foreground">
              Deep link:{" "}
              <code className="text-foreground">
                polarr://connect?url={encodeURIComponent(baseUrl)}
              </code>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pairing code</CardTitle>
            <CardDescription>
              Scaffold for QR pairing in the Expo iOS app.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-4">
            <QRCodePlaceholder value={baseUrl} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Offline streaming contract</CardTitle>
          <CardDescription>
            Endpoints the iOS app uses for catalog and byte-range audio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 font-mono text-sm text-muted-foreground">
            <li>POST /api/auth/login → token</li>
            <li>GET /api/library → catalog</li>
            <li>GET /api/stream/:id (Accept-Ranges: bytes)</li>
            <li>POST /api/tracks/:id → mark offline intent</li>
            <li>GET /api/search?q=… → request missing music</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
