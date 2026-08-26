"use client";

import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

/** Stable hash → hue for a vivid Liked Songs wash. */
export function likedSongsGradientStyle(seed: string): {
  backgroundImage: string;
} {
  let h = 2166136261;
  const s = seed.trim() || "liked";
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = Math.abs(h) % 360;
  const hue2 = (hue + 38 + (Math.abs(h) % 48)) % 360;
  const hue3 = (hue + 78 + (Math.abs(h >> 8) % 36)) % 360;
  return {
    backgroundImage: `linear-gradient(135deg, hsl(${hue} 82% 46%), hsl(${hue2} 74% 40%), hsl(${hue3} 68% 52%))`,
  };
}

let cachedUserSeed: string | null = null;
let seedPromise: Promise<string> | null = null;

function resolveUserSeed(): Promise<string> {
  if (cachedUserSeed) return Promise.resolve(cachedUserSeed);
  if (!seedPromise) {
    seedPromise = fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const u = data?.user;
        const seed =
          (typeof u?.publicId === "string" && u.publicId) ||
          (typeof u?.username === "string" && u.username) ||
          "liked";
        cachedUserSeed = seed;
        return seed;
      })
      .catch(() => {
        seedPromise = null;
        return "liked";
      });
  }
  return seedPromise;
}

/**
 * Liked Songs cover — gradient is deterministic per user (publicId / username),
 * so each account gets its own color, not the same purple for everyone.
 */
export function LikedSongsCover({
  className,
  heartClassName,
  seed,
}: {
  className?: string;
  heartClassName?: string;
  /** Override seed (e.g. another user’s profile). Defaults to signed-in user. */
  seed?: string;
}) {
  const [resolved, setResolved] = useState(seed?.trim() || cachedUserSeed || "");

  useEffect(() => {
    if (seed?.trim()) {
      setResolved(seed.trim());
      return;
    }
    let cancelled = false;
    void resolveUserSeed().then((s) => {
      if (!cancelled) setResolved(s);
    });
    return () => {
      cancelled = true;
    };
  }, [seed]);

  return (
    <div
      className={cn("flex items-center justify-center", className)}
      style={likedSongsGradientStyle(resolved || "liked")}
      aria-hidden
    >
      <Heart
        className={cn("fill-white text-white", heartClassName ?? "size-3.5")}
        strokeWidth={0}
      />
    </div>
  );
}
