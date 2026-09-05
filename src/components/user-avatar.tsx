"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useNativeMediaDisplaySrc } from "@/lib/use-native-media-src";

/**
 * Profile image with initial fallback when missing or load fails
 * (stale absolute paths after data-dir moves used to show broken icons).
 */
export function UserAvatar({
  username,
  avatarUrl,
  className,
  imgClassName,
  textClassName,
}: {
  username: string;
  avatarUrl?: string | null;
  className?: string;
  imgClassName?: string;
  textClassName?: string;
}) {
  const resolved = useNativeMediaDisplaySrc(avatarUrl);
  const [broken, setBroken] = useState(false);
  const letter = (username.trim()[0] || "?").toUpperCase();
  const showImg = Boolean(resolved) && !broken;

  useEffect(() => {
    setBroken(false);
  }, [resolved]);

  return (
    <span
      className={cn(
        "relative flex size-full items-center justify-center overflow-hidden bg-muted text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolved!}
          alt=""
          className={cn("absolute inset-0 size-full object-cover", imgClassName)}
          onError={() => setBroken(true)}
        />
      ) : (
        <span className={cn("font-semibold uppercase", textClassName)}>
          {letter}
        </span>
      )}
    </span>
  );
}
