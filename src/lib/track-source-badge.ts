/** Admin-facing local file source — Lidarr library vs Polarr fallback. */
export type LocalSourceBadge = "lidarr" | "polarr";

export function localSourceBadge(
  source: string | null | undefined,
): LocalSourceBadge {
  return source === "fallback" ? "polarr" : "lidarr";
}

export const ADMIN_SOURCE_LABELS: Record<LocalSourceBadge, string> = {
  lidarr: "Lidarr",
  polarr: "Polarr",
};
