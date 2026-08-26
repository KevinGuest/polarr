"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type PlayerGlassBackdropProps = {
  image?: string | null;
  seed: string;
  className?: string;
};

function seedHue(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

/**
 * Apple Music–style living backdrop: oversized blurred cover art that drifts,
 * with a frosted glass wash so UI reads as see-through over moving color.
 */
export function PlayerGlassBackdrop({
  image,
  seed,
  className,
}: PlayerGlassBackdropProps) {
  const [ready, setReady] = useState(false);
  const hue = seedHue(seed);
  const hue2 = (hue + 48) % 360;

  useEffect(() => {
    setReady(false);
    if (!image) {
      setReady(true);
      return;
    }
    const img = new Image();
    img.onload = () => setReady(true);
    img.onerror = () => setReady(true);
    img.src = image;
  }, [image]);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
      aria-hidden
    >
      {/* Soft base so empty frames never flash white */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 80% at 30% 20%, hsl(${hue} 38% 28%), hsl(${hue2} 32% 12%) 55%, hsl(0 0% 4%))`,
        }}
      />

      {image ? (
        <>
          {/* Living blurred artwork — scales past the frame and slowly drifts */}
          <div
            className={cn(
              "absolute -inset-[28%] opacity-0 transition-opacity duration-700",
              ready && "opacity-100 animate-player-glass-drift",
            )}
            style={{
              backgroundImage: `url(${JSON.stringify(image)})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(72px) saturate(1.35) brightness(0.78)",
              transform: "scale(1.2)",
              willChange: "transform",
            }}
          />
          {/* Second softer layer, counter-drift for depth */}
          <div
            className={cn(
              "absolute -inset-[35%] opacity-0 mix-blend-lighten transition-opacity duration-700",
              ready && "opacity-50 animate-player-glass-drift-alt",
            )}
            style={{
              backgroundImage: `url(${JSON.stringify(image)})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(96px) saturate(1.5) brightness(0.9)",
              transform: "scale(1.35)",
              willChange: "transform",
            }}
          />
        </>
      ) : (
        <>
          <div
            className="absolute -left-1/4 top-[-10%] size-[90%] rounded-full opacity-70 blur-3xl animate-player-glass-drift"
            style={{
              background: `radial-gradient(circle, hsl(${hue} 55% 42% / 0.85), transparent 70%)`,
            }}
          />
          <div
            className="absolute -right-1/4 bottom-[-5%] size-[80%] rounded-full opacity-60 blur-3xl animate-player-glass-drift-alt"
            style={{
              background: `radial-gradient(circle, hsl(${hue2} 50% 36% / 0.75), transparent 70%)`,
            }}
          />
        </>
      )}

      {/* Frosted glass wash — lets the moving art show through */}
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/55" />
      {/* Edge vignette so lyrics stay readable */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.55)_100%)]" />
    </div>
  );
}
