/** Sample dominant colors from an image for profile banner gradients. */

type Rgb = { r: number; g: number; b: number; n: number; sat: number };

export async function extractBannerColors(source: Blob): Promise<string[]> {
  const bitmap = await createImageBitmap(source);
  try {
    return colorsFromBitmap(bitmap);
  } finally {
    bitmap.close();
  }
}

/** Re-sample an already-hosted avatar (keeps banner in sync with the photo). */
export async function extractBannerColorsFromUrl(
  url: string,
): Promise<string[] | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.type.startsWith("image/") && blob.size === 0) return null;
  return extractBannerColors(blob);
}

function colorsFromBitmap(bitmap: ImageBitmap): string[] {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return defaultBanner();
  ctx.drawImage(bitmap, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Skip near-black / near-white — they wash out banners
    if (max < 28 || min > 235) continue;
    // Quantize lightly so similar tones merge
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    cur.r += r;
    cur.g += g;
    cur.b += b;
    cur.n += 1;
    buckets.set(key, cur);
  }

  const ranked: Rgb[] = [...buckets.values()]
    .filter((c) => c.n >= 2)
    .map((c) => {
      const r = c.r / c.n;
      const g = c.g / c.n;
      const b = c.b / c.n;
      return { r, g, b, n: c.n, sat: saturation(r, g, b) };
    })
    .sort((a, b) => b.n * (0.55 + b.sat) - a.n * (0.55 + a.sat));

  if (ranked.length === 0) return defaultBanner();

  // Prefer a vivid dominant tone; fall back to the most common
  const primary =
    ranked.find((c) => c.sat > 0.12 && c.n >= ranked[0].n * 0.35) ??
    ranked[0];

  // Same-hue family for the whole wash so it reads as the avatar, not a clash
  const { h, s } = rgbToHsl(primary.r, primary.g, primary.b);
  const topSat = clamp(s * 100 * 1.05, 22, 72);
  const midSat = clamp(s * 100 * 0.9, 16, 58);
  const top = `hsl(${h} ${Math.round(topSat)}% 42%)`;
  const mid = `hsl(${h} ${Math.round(midSat)}% 22%)`;
  const bottom = "hsl(var(--background))";
  return [top, mid, bottom];
}

function defaultBanner() {
  return ["hsl(0 0% 22%)", "hsl(var(--background))"];
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function saturation(r: number, g: number, b: number) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const d = max - min;
  const l = (max + min) / 2;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: Math.round(h * 360), s, l };
}
