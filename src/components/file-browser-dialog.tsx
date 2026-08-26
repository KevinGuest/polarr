"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronUp, Folder, File, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type FsEntry = {
  name: string;
  path: string;
  type: "dir" | "file";
};

type BrowsePayload = {
  path: string;
  parent: string | null;
  entries: FsEntry[];
  error?: string;
};

/**
 * Sonarr/Lidarr-style folder picker for admin music root.
 */
export function FileBrowserDialog({
  open,
  onOpenChange,
  initialPath,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPath?: string;
  onSelect: (path: string) => void;
}) {
  const [pathInput, setPathInput] = useState(initialPath || "/");
  const [cwd, setCwd] = useState(initialPath || "/");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (dir: string) => {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const res = await fetch(
        `/api/admin/fs?path=${encodeURIComponent(dir)}`,
        { cache: "no-store" },
      );
      const data = (await res.json().catch(() => null)) as BrowsePayload | null;
      if (!res.ok || !data) {
        setError(
          typeof data?.error === "string" ? data.error : "Couldn’t open folder",
        );
        if (data?.path) {
          setCwd(data.path);
          setPathInput(data.path);
          setParent(data.parent ?? null);
        }
        setEntries([]);
        return;
      }
      setCwd(data.path);
      setPathInput(data.path);
      setParent(data.parent);
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setError("Couldn’t open folder");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const start = (initialPath || "/").trim() || "/";
    setPathInput(start);
    void load(start);
  }, [open, initialPath, load]);

  function goParent() {
    if (!parent) return;
    void load(parent);
  }

  function confirm() {
    const chosen = (selected || cwd || pathInput).trim();
    if (!chosen) return;
    onSelect(chosen);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(85vh,640px)] w-[min(100vw-1.5rem,36rem)] flex-col gap-3 overflow-hidden p-0 sm:rounded-xl">
        <DialogHeader className="shrink-0 space-y-0 border-b border-border px-4 py-3 pr-12 text-left">
          <DialogTitle className="text-base font-semibold">
            File Browser
          </DialogTitle>
        </DialogHeader>

        <div className="shrink-0 px-4">
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void load(pathInput.trim() || "/");
              }
            }}
            placeholder="Start typing or select a path below."
            className="h-10 font-mono text-sm"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-y border-border bg-muted/20">
          <div className="sticky top-0 z-[1] grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 border-b border-border bg-background px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Type</span>
            <span>Name</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : error ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {error}
            </p>
          ) : (
            <ul className="pb-2">
              {parent ? (
                <li>
                  <button
                    type="button"
                    onClick={goParent}
                    className="grid w-full grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 px-4 py-2 text-left text-sm hover:bg-muted/60"
                  >
                    <ChevronUp className="size-4 text-muted-foreground" />
                    <span className="truncate font-medium">..</span>
                  </button>
                </li>
              ) : null}
              {entries.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Empty folder
                </li>
              ) : (
                entries.map((entry) => {
                  const isDir = entry.type === "dir";
                  const active = selected === entry.path;
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        onClick={() => {
                          if (isDir) {
                            setSelected(entry.path);
                          } else {
                            setSelected(cwd);
                          }
                        }}
                        onDoubleClick={() => {
                          if (isDir) void load(entry.path);
                          else confirm();
                        }}
                        className={cn(
                          "grid w-full grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 px-4 py-2 text-left text-sm transition-colors",
                          active
                            ? "bg-muted text-foreground"
                            : "hover:bg-muted/60",
                        )}
                      >
                        {isDir ? (
                          <Folder className="size-4 text-amber-500/90" />
                        ) : (
                          <File className="size-4 text-muted-foreground" />
                        )}
                        <span className="truncate">{entry.name}</span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t-0 px-4 py-3 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={confirm} disabled={!cwd && !selected}>
            Ok
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
