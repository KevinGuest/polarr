"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

export function LikeButton({
  liked,
  onToggle,
  className,
  size = "sm",
  /** Hide until row hover; stays visible when liked. Needs a `group` ancestor. */
  revealOnHover = false,
  /** Player / dark surfaces: primary fill when liked. */
  tone = "default",
}: {
  liked: boolean;
  onToggle: () => void;
  className?: string;
  size?: "sm" | "md";
  revealOnHover?: boolean;
  tone?: "default" | "on-dark";
}) {
  const icon = size === "md" ? "size-5" : "size-4";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
      className={cn(
        "shrink-0 rounded-full p-1.5 transition-colors",
        revealOnHover &&
          !liked &&
          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        className,
        tone === "on-dark"
          ? liked
            ? "text-primary hover:text-primary/90"
            : "text-white/55 hover:text-white"
          : liked
            ? "text-foreground hover:text-foreground/80"
            : "text-muted-foreground hover:text-foreground",
      )}
      aria-label={liked ? "Unlike" : "Like"}
      aria-pressed={liked}
    >
      <Heart
        className={icon}
        fill={liked ? "currentColor" : "none"}
        strokeWidth={liked ? 0 : 1.75}
      />
    </button>
  );
}
