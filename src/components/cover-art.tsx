"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { nativeAssetUrl } from "@/lib/native-client";

export function CoverArt({
  seed,
  image,
  className,
  loading = false,
}: {
  seed: string;
  image?: string | null;
  className?: string;
  /** Dim cover and show spinner (e.g. while resolving stream playback). */
  loading?: boolean;
}) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 40 + (h % 50)) % 360;

  const resolvedImage = nativeAssetUrl(image);
  const style = resolvedImage
    ? {
        backgroundImage: `url(${JSON.stringify(resolvedImage)})`,
        backgroundSize: "cover" as const,
        backgroundPosition: "center" as const,
      }
    : {
        backgroundImage: `linear-gradient(${h % 360}deg, hsl(${hue} 48% 38%), hsl(${hue2} 42% 22%))`,
      };

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden", className)}
      aria-hidden={!loading}
      aria-busy={loading || undefined}
    >
      <div
        className={cn(
          "absolute inset-0 transition-[filter,opacity] duration-150",
          loading && "brightness-[0.42] saturate-75",
        )}
        style={style}
        aria-hidden
      />
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <Loader2
            className="size-5 animate-spin text-white drop-shadow-sm sm:size-6"
            aria-hidden
          />
        </div>
      ) : null}
    </div>
  );
}
