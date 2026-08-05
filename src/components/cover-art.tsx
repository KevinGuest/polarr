"use client";

export function CoverArt({
  seed,
  image,
  className,
}: {
  seed: string;
  image?: string | null;
  className?: string;
}) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 40 + (h % 50)) % 360;
  if (image) {
    return (
      <div
        className={className}
        style={{
          backgroundImage: `url(${JSON.stringify(image)})`,
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
        backgroundImage: `linear-gradient(${h % 360}deg, hsl(${hue} 48% 38%), hsl(${hue2} 42% 22%))`,
      }}
      aria-hidden
    />
  );
}
