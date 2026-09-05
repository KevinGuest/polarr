"use client";

import { useEffect, useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

type PlayerSliderProps = {
  /** 0–1 */
  value: number;
  onChange: (value: number) => void;
  "aria-label": string;
  className?: string;
  variant?: "progress" | "volume";
  /** White track for expanded mobile player; default for dock / desktop */
  tone?: "on-dark" | "default";
};

export function PlayerSlider({
  value,
  onChange,
  "aria-label": ariaLabel,
  className,
  variant = "progress",
  tone = "on-dark",
}: PlayerSliderProps) {
  const [active, setActive] = useState(false);
  /** Hold the scrub value so live timeupdate doesn't yank the thumb mid-drag. */
  const [scrub, setScrub] = useState<number | null>(null);
  const clamped = Math.min(1, Math.max(0, scrub ?? value));
  const sliderValue =
    variant === "progress"
      ? Math.round(clamped * 1000) / 10
      : Math.round(clamped * 100);

  const onDark = tone === "on-dark";

  useEffect(() => {
    if (!active) return;
    const end = () => {
      setActive(false);
      setScrub(null);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, [active]);

  return (
    <SliderPrimitive.Root
      value={[sliderValue]}
      onValueChange={(vals) => {
        const next = vals[0];
        if (typeof next !== "number") return;
        const ratio = next / 100;
        setScrub(ratio);
        onChange(ratio);
      }}
      onValueCommit={() => {
        setActive(false);
        setScrub(null);
      }}
      max={100}
      step={variant === "progress" ? 0.1 : 1}
      aria-label={ariaLabel}
      onPointerDown={(event) => {
        // Keep sheet dismiss / scroll gestures from stealing the scrub.
        event.stopPropagation();
        setActive(true);
      }}
      onTouchStart={(event) => {
        event.stopPropagation();
        setActive(true);
      }}
      className={cn(
        "relative flex w-full touch-none select-none items-center py-3",
        className,
      )}
    >
      <SliderPrimitive.Track
        className={cn(
          "relative w-full grow overflow-hidden rounded-full transition-[height] duration-150 ease-out",
          active
            ? variant === "volume"
              ? "h-2.5"
              : "h-2"
            : variant === "volume"
              ? "h-1"
              : "h-[3px]",
          onDark ? "bg-white/25" : "bg-muted",
        )}
      >
        <SliderPrimitive.Range
          className={cn(
            "absolute h-full rounded-full",
            onDark ? "bg-white" : "bg-foreground",
          )}
        />
      </SliderPrimitive.Track>
      {/* Large invisible thumb — Radix hit target; must be big enough for thumbs */}
      <SliderPrimitive.Thumb className="block size-11 opacity-0" />
    </SliderPrimitive.Root>
  );
}
