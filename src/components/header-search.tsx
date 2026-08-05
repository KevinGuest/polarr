"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { usePlayer } from "@/components/player-provider";

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
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="search"
        name="polarr-search"
        value={value}
        placeholder="Search artists, albums, tracks…"
        aria-label="Search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        data-protonpass-ignore="true"

        onFocus={() => {
          if (!onSearchPage) goSearch(value);
          else setPanel("none");
        }}
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
        className="flex h-9 w-full rounded-full border border-border bg-transparent pl-9 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/30 focus:border-foreground/40 focus:ring-0"
      />
    </div>
  );
}
