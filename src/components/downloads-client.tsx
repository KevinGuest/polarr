"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Laptop,
  Monitor,
  Server,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FALLBACK_DESKTOP_RELEASE,
  type DesktopRelease,
} from "@/lib/desktop-release";

type Platform = "macos" | "windows" | "other";

type DownloadOption = {
  id: Exclude<Platform, "other">;
  name: string;
  description: string;
  detail: string;
  url: string;
  icon: typeof Laptop;
};

function detectPlatform(): Platform {
  const agent = `${navigator.userAgent} ${navigator.platform}`;
  if (/Macintosh|Mac OS X|MacIntel/i.test(agent)) return "macos";
  if (/Windows|Win32|Win64/i.test(agent)) return "windows";
  return "other";
}

function DownloadCard({
  option,
  version,
  primary,
}: {
  option: DownloadOption;
  version: string;
  primary: boolean;
}) {
  const Icon = option.icon;
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-card p-5 sm:p-6",
        primary ? "border-foreground/20 shadow-sm" : "border-border",
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl",
            primary ? "bg-foreground text-background" : "bg-muted text-foreground",
          )}
        >
          <Icon className="size-6" strokeWidth={1.7} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{option.name}</h2>
            {primary ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Recommended
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {option.description}
          </p>
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
        <a
          href={option.url}
          className={cn(
            "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-opacity hover:opacity-85",
            primary
              ? "bg-foreground text-background"
              : "border border-border bg-background text-foreground",
          )}
        >
          <Download className="size-4" />
          Download for {option.name}
        </a>
        <p className="text-xs text-muted-foreground">
          v{version} · {option.detail}
        </p>
      </div>
    </article>
  );
}

export function DownloadsClient() {
  const [platform, setPlatform] = useState<Platform>("other");
  const [release, setRelease] = useState<DesktopRelease>(
    FALLBACK_DESKTOP_RELEASE,
  );

  useEffect(() => {
    setPlatform(detectPlatform());
    void fetch("/api/desktop-release", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: DesktopRelease | null) => {
        if (data?.version && data.macosUrl && data.windowsUrl) setRelease(data);
      })
      .catch(() => null);
  }, []);

  const options = useMemo<DownloadOption[]>(
    () => [
      {
        id: "macos",
        name: "macOS",
        description: "A universal build for Apple silicon and Intel Macs.",
        detail: "macOS 10.15 or newer",
        url: release.macosUrl,
        icon: Laptop,
      },
      {
        id: "windows",
        name: "Windows",
        description: "The desktop player for 64-bit Windows computers.",
        detail: "Windows 10 or newer",
        url: release.windowsUrl,
        icon: Monitor,
      },
    ],
    [release.macosUrl, release.windowsUrl],
  );

  const ordered = useMemo(() => {
    if (platform === "other") return options;
    return [...options].sort((option) => (option.id === platform ? -1 : 1));
  }, [options, platform]);

  return (
    <div className="mx-auto w-full max-w-4xl pb-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Downloads</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-6 text-muted-foreground">
          Get Polarr for your computer.
        </p>
      </header>

      <div className="mt-9 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Desktop apps
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            {platform === "other" ? "Choose your platform" : "Made for this computer"}
          </h2>
        </div>
        <a
          href={release.releaseUrl}
          target="_blank"
          rel="noreferrer"
          className="hidden items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
        >
          Release details <ExternalLink className="size-3.5" />
        </a>
      </div>

      <div className="mt-4 grid gap-4 2xl:grid-cols-2">
        {ordered.map((option, index) => (
          <DownloadCard
            key={option.id}
            option={option}
            version={release.version}
            primary={
              platform === "other" ? index === 0 : option.id === platform
            }
          />
        ))}
      </div>

      <section className="mt-10">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Mobile apps
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          Listen on your phone
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {["iOS", "Android"].map((name) => (
            <article
              key={name}
              className="flex min-h-24 items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4"
            >
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Smartphone className="size-5" strokeWidth={1.7} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-foreground">{name}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Polarr for {name}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                Coming soon
              </span>
            </article>
          ))}
        </div>
      </section>

      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-border px-5 py-4 text-sm text-muted-foreground">
        <Server className="mt-0.5 size-4 shrink-0" />
        <p className="leading-5">
          Your library stays on your Polarr server. The desktop app asks for its
          address the first time it opens, then keeps itself updated automatically.
        </p>
      </div>
    </div>
  );
}
