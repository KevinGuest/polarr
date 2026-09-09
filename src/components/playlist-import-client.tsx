"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { AUTH_CONTROL, AUTH_SUBMIT, AuthFieldGroup } from "@/components/auth-screen";
import { InsetGroup } from "@/components/media-shelf";
import {
  AppleMusicMark,
  DeezerMark,
  SpotifyMark,
  YoutubeMusicMark,
} from "@/components/service-brand-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { emitLibraryChanged } from "@/lib/ui-events";
import { toastError } from "@/lib/toast";

type ServiceId = "spotify" | "youtube" | "deezer" | "apple";

type ImportResult = {
  playlistId: string;
  name: string;
  matched: number;
  unresolved: number;
  total: number;
  coverImported?: boolean;
};

type Phase = "form" | "running" | "done" | "error";

const SERVICES: {
  id: ServiceId;
  label: string;
  hint: string;
  placeholder: string;
  Mark: typeof SpotifyMark;
}[] = [
  {
    id: "spotify",
    label: "Spotify",
    hint: "Public playlist or album link",
    placeholder: "https://open.spotify.com/playlist/…",
    Mark: SpotifyMark,
  },
  {
    id: "youtube",
    label: "YouTube Music",
    hint: "Playlist or mix link",
    placeholder: "https://music.youtube.com/playlist?list=…",
    Mark: YoutubeMusicMark,
  },
  {
    id: "deezer",
    label: "Deezer",
    hint: "Public playlist link",
    placeholder: "https://www.deezer.com/playlist/…",
    Mark: DeezerMark,
  },
  {
    id: "apple",
    label: "Apple Music",
    hint: "Coming soon",
    placeholder: "https://music.apple.com/…/playlist/…",
    Mark: AppleMusicMark,
  },
];

const RUN_STEPS = [
  "Reading the playlist",
  "Matching tracks in your library",
  "Saving your new playlist",
] as const;

export function PlaylistImportClient() {
  const router = useRouter();
  const [service, setService] = useState<ServiceId>("spotify");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [serviceReady, setServiceReady] = useState<Record<string, boolean>>({
    spotify: true,
    youtube: true,
    deezer: true,
    apple: false,
  });
  const [phase, setPhase] = useState<Phase>("form");
  const [runStep, setRunStep] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = SERVICES.find((s) => s.id === service)!;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/playlists/import", { cache: "no-store" });
      if (cancelled) return;
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.services) setServiceReady(data.services);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (phase !== "running") return;
    setRunStep(0);
    const timers = [
      window.setTimeout(() => setRunStep(1), 900),
      window.setTimeout(() => setRunStep(2), 2200),
    ];
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [phase]);

  async function runImport() {
    const url = playlistUrl.trim();
    if (!url) {
      toastError("Paste a playlist link from the service you picked.");
      return;
    }
    setPhase("running");
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/playlists/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service,
          url,
          name: playlistName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof data.error === "string" ? data.error : "Import failed";
        setError(message);
        setPhase("error");
        return;
      }
      setResult({
        playlistId: data.playlistId,
        name: data.name,
        matched: data.matched,
        unresolved: data.unresolved,
        total: data.total,
        coverImported: Boolean(data.coverImported),
      });
      emitLibraryChanged();
      setPhase("done");
    } catch {
      setError("Import failed. Check your connection and try again.");
      setPhase("error");
    }
  }

  function resetForm() {
    setPhase("form");
    setResult(null);
    setError(null);
    setRunStep(0);
    setPlaylistUrl("");
    setPlaylistName("");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-1">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/settings?tab=playlists")}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted"
            aria-label="Back to playlists"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="min-w-0 text-[2rem] font-semibold tracking-tight">
            Import
          </h1>
        </div>
        <p className="pl-12 text-[15px] text-muted-foreground">
          {phase === "form"
            ? "Pick a service and paste a public playlist or album link."
            : phase === "running"
              ? "Hang tight — we’re bringing this into Polarr."
              : phase === "done"
                ? "Import finished."
                : "Something went wrong."}
        </p>
      </div>

      {phase === "form" ? (
        <div className="space-y-5">
          <InsetGroup>
            {SERVICES.map((s) => {
              const disabled =
                s.id === "apple" || serviceReady[s.id] === false;
              const selected = service === s.id;
              const Mark = s.Mark;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setService(s.id)}
                  className={cn(
                    "flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors",
                    selected ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                    disabled && "cursor-not-allowed opacity-45",
                  )}
                >
                  <Mark className="size-9" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold text-foreground">
                      {s.label}
                    </span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      {disabled && s.id === "apple" ? "Coming soon" : s.hint}
                    </span>
                  </span>
                  {selected && !disabled ? (
                    <Check
                      className="size-5 shrink-0 text-foreground"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  ) : null}
                </button>
              );
            })}
          </InsetGroup>

          <AuthFieldGroup>
            <div className="px-4 pb-2 pt-3">
              <Label
                htmlFor="import-url"
                className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground"
              >
                Link
              </Label>
              <Input
                id="import-url"
                value={playlistUrl}
                onChange={(e) => setPlaylistUrl(e.target.value)}
                placeholder={active.placeholder}
                autoComplete="off"
                inputMode="url"
                enterKeyHint="go"
                className={cn(AUTH_CONTROL, "h-12 px-0")}
              />
            </div>
            <div className="px-4 pb-3 pt-2">
              <Label
                htmlFor="import-name"
                className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground"
              >
                Name · optional
              </Label>
              <Input
                id="import-name"
                value={playlistName}
                onChange={(e) => setPlaylistName(e.target.value)}
                placeholder="Uses the playlist title if empty"
                maxLength={80}
                className={cn(AUTH_CONTROL, "h-12 px-0")}
              />
            </div>
          </AuthFieldGroup>

          <Button
            type="button"
            className={cn(AUTH_SUBMIT, "mt-0")}
            disabled={service === "apple" || !playlistUrl.trim()}
            onClick={() => void runImport()}
          >
            Import
          </Button>
        </div>
      ) : null}

      {phase === "running" ? (
        <InsetGroup>
          <div className="space-y-1 px-4 py-4">
            {RUN_STEPS.map((label, index) => {
              const activeStep = index === runStep;
              const done = index < runStep;
              return (
                <div
                  key={label}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-2 py-3",
                    activeStep && "bg-white/[0.06]",
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center">
                    {done ? (
                      <Check className="size-5 text-foreground" strokeWidth={2.5} />
                    ) : activeStep ? (
                      <Loader2 className="size-5 animate-spin text-foreground" />
                    ) : (
                      <span className="size-2 rounded-full bg-muted-foreground/40" />
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-[16px]",
                      activeStep || done
                        ? "font-medium text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </InsetGroup>
      ) : null}

      {phase === "done" && result ? (
        <div className="space-y-5">
          <InsetGroup>
            <div className="space-y-2 px-4 py-4 text-[15px]">
              <p className="text-[1.125rem] font-semibold text-foreground">
                Created “{result.name}”
              </p>
              <p className="text-muted-foreground">
                {result.matched} of {result.total} tracks added
                {result.unresolved > 0
                  ? ` · ${result.unresolved} unmatched`
                  : ""}
                {result.coverImported ? " · cover imported" : ""}.
              </p>
            </div>
          </InsetGroup>
          <div className="flex flex-col gap-2">
            <Button asChild className={cn(AUTH_SUBMIT, "mt-0")}>
              <Link href={`/playlist/${encodeURIComponent(result.playlistId)}`}>
                Open playlist
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-12 w-full text-[15px] text-muted-foreground"
              onClick={resetForm}
            >
              Import another
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="space-y-5">
          <InsetGroup>
            <div className="space-y-2 px-4 py-4 text-[15px]">
              <p className="text-[1.125rem] font-semibold text-foreground">
                Import failed
              </p>
              <p className="text-muted-foreground">
                {error || "Something went wrong."}
              </p>
            </div>
          </InsetGroup>
          <Button
            type="button"
            className={cn(AUTH_SUBMIT, "mt-0")}
            onClick={() => setPhase("form")}
          >
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
