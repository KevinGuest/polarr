"use client";

import { Users } from "lucide-react";

export function JamClient() {
  return (
    <div className="flex min-h-full flex-col">
      <section className="relative -mx-6 -mt-6 border-b border-border px-6 pb-10 pt-8 md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            background:
              "linear-gradient(180deg, hsl(152 30% 18%) 0%, hsl(var(--background)) 100%)",
          }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end">
          <div
            className="flex size-44 shrink-0 items-center justify-center rounded-lg bg-[#282828] text-white shadow-lg sm:size-52 md:size-56"
            aria-hidden
          >
            <Users className="size-16 sm:size-20" strokeWidth={1.25} />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Jam
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
              Listen together
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Jam sessions aren’t wired up yet. This is a placeholder so Create
              → Jam has somewhere to go. Shared listening will land here later.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
