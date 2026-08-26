/** Local file badge — Lidarr library vs Polarr fallback download. */
export type LocalSourceBadge = "lidarr" | "polarr";

export function localSourceBadge(
  source: string | null | undefined,
): LocalSourceBadge {
  return source === "fallback" ? "polarr" : "lidarr";
}

export const LOCAL_SOURCE_LABELS: Record<LocalSourceBadge, string> = {
  lidarr: "Lidarr",
  polarr: "Polarr",
};

export const LOCAL_SOURCE_AVAILABLE: Record<LocalSourceBadge, string> = {
  lidarr: "Available on Lidarr",
  polarr: "Downloaded via Polarr",
};

export const LOCAL_SOURCE_PLAYING: Record<LocalSourceBadge, string> = {
  lidarr: "Playing from Lidarr library",
  polarr: "Playing from Polarr download",
};
