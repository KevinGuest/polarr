"use client";

export function CoverArt({
  seed,
  image,
  className,
}: {
  seed: string;
  image?: string;
  className?: string;
}) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const a = 20 + (h % 40);
  const b = 40 + ((h >> 3) % 35);
  if (image) {
    return (
      <div
        className={className}
        style={{
          backgroundImage: `url(${image})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        aria-hidden
      />
    );
  }
  return (
    <div
      className={className}
      style={{
        backgroundImage: `linear-gradient(${h % 360}deg, hsl(0 0% ${a}%), hsl(0 0% ${b}%))`,
      }}
      aria-hidden
    />
  );
}
