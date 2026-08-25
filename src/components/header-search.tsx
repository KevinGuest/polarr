"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { usePlayer } from "@/components/player-provider";
import { cn } from "@/lib/utils";

/** Global header search — types into `/search?q=` and keeps the page rendered. */
export function HeaderSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setPanel } = usePlayer();
  const inputRef = useRef<HTMLInputElement>(null);
  const onSearchPage = pathname === "/search";
  const urlQ = onSearchPage ? searchParams.get("q") || "" : "";
  const [value, setValue] = useState(urlQ);
  const [focused, setFocused] = useState(false);
  const idle = !focused && !value;

  useEffect(() => {
    if (!onSearchPage) {
      setValue("");
      return;
    }
    const next = searchParams.get("q") || "";
    // Don't clobber in-progress typing in the header field
    if (document.activeElement === inputRef.current) return;
    setValue(next);
  }, [onSearchPage, searchParams]);

  function goSearch(next: string) {
    setPanel("none");
    const trimmed = next.trim();
    const href = trimmed
      ? `/search?q=${encodeURIComponent(trimmed)}`
      : "/search";
    router.replace(href);
  }

  return (
    <div className="relative w-full justify-self-center">
      {/* Idle: icon + label centered as one group (input placeholder kept for a11y, visually replaced) */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-muted-foreground transition-opacity duration-150",
          idle ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      >
        <Search className="size-3.5 shrink-0" />
        <span className="text-sm">Search</span>
      </div>
      {/* Focused / has text: icon pinned left */}
      <Search
        className={cn(
          "pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground transition-opacity duration-150",
          idle ? "opacity-0" : "opacity-100",
        )}
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        name="polarr-search"
        value={value}
        placeholder="Search"
        aria-label="Search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        data-protonpass-ignore="true"
        onFocus={() => {
          setFocused(true);
          if (!onSearchPage) goSearch(value);
          else setPanel("none");
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          goSearch(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            inputRef.current?.blur();
          }
        }}
        className={cn(
          "flex h-9 w-full rounded-full border border-border bg-transparent text-sm text-foreground outline-none transition-[padding,color,border-color] duration-150 hover:border-foreground/30 focus:border-foreground/40 focus:ring-0",
          idle
            ? "px-4 text-center placeholder:text-transparent"
            : "pl-9 pr-4 text-left placeholder:text-muted-foreground",
        )}
      />
    </div>
  );
}
