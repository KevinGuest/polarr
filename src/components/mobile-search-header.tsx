"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export function MobileSearchHeader({
  onCancel,
}: {
  onCancel?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const q = searchParams.get("q") || "";
  const [value, setValue] = useState(q);

  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setValue(q);
  }, [q]);

  const navigate = useCallback(
    (nextQ: string) => {
      const trimmed = nextQ.trim();
      const qs = new URLSearchParams();
      if (trimmed) qs.set("q", trimmed);
      if (searchParams.get("scope") === "library") qs.set("scope", "library");
      const href = qs.toString() ? `/search?${qs.toString()}` : "/search";
      router.replace(href);
    },
    [router, searchParams],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function cancel() {
    if (onCancel) {
      onCancel();
      return;
    }
    if (q) {
      router.replace("/search");
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }

  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-border/60 bg-background/95 px-4 pb-3 pt-[max(0.75rem,var(--safe-top))] backdrop-blur-md lg:hidden">
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="search"
          name="polarr-mobile-search"
          value={value}
          placeholder="What do you want to listen to?"
          aria-label="Search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            navigate(next);
          }}
          className={cn(
            "min-w-0 flex-1 rounded-lg border-0 bg-muted/60 px-4 py-3 text-base text-foreground outline-none",
            "placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/15",
          )}
        />
        <button
          type="button"
          onClick={cancel}
          className="shrink-0 text-sm font-medium text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
