"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DOWNLOAD_QUALITIES,
  DEFAULT_DOWNLOAD_QUALITY,
  isDownloadQuality,
  type DownloadQuality,
} from "@/lib/download-quality";
import { toastError, toastSaved } from "@/lib/toast";

export function AdminQualityClient() {
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<DownloadQuality>(DEFAULT_DOWNLOAD_QUALITY);
  const [choice, setChoice] = useState<DownloadQuality>(
    DEFAULT_DOWNLOAD_QUALITY,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (cancelled || !res.ok) {
        setLoading(false);
        return;
      }
      const data = await res.json();
      const q = String(data.downloadQuality || "");
      if (isDownloadQuality(q)) {
        setSaved(q);
        setChoice(q);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ downloadQuality: choice }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(typeof data.error === "string" ? data.error : "Save failed");
        return;
      }
      setSaved(choice);
      toastSaved();
    } finally {
      setSaving(false);
    }
  }

  const dirty = choice !== saved;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Quality</h1>
        <p className="text-sm text-muted-foreground">
          Audio quality for downloads. Applies to new downloads only.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div
            role="radiogroup"
            aria-label="Download quality"
            className="overflow-hidden rounded-xl border border-border"
          >
            {DOWNLOAD_QUALITIES.map((q, i) => {
              const active = choice === q.id;
              return (
                <button
                  key={q.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChoice(q.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors",
                    i > 0 && "border-t border-border",
                    active ? "bg-muted/60" : "hover:bg-muted/30",
                  )}
                >
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      {q.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {q.detail}
                    </span>
                  </span>
                  {active ? (
                    <Check
                      className="size-4 shrink-0 text-emerald-400"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          <Button
            type="button"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
