/**
 * Cover URLs arrive at the player from three sources with different lifetimes:
 * live API payloads (absolute http(s) or root-relative server paths), restored
 * localStorage / Connect state, and the native offline artwork cache, which
 * substitutes `blob:` object URLs. Object URLs paint in the document that
 * created them but die on reload, and iOS cannot fetch them for Now Playing
 * artwork — so they must never be persisted or handed to the OS.
 */

/** Object/data URL: renderable in this document only, dead after a reload. */
export function isEphemeralCoverUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const lower = value.trim().toLowerCase();
  return lower.startsWith("blob:") || lower.startsWith("data:");
}

function isServerCoverUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("/");
}

/**
 * Cover URL for in-app artwork (`CoverArt` authenticates server paths through
 * the native media bridge). Object URLs are kept so offline art still paints.
 */
export function playerCoverUrl(
  coverPath: string | null | undefined,
): string | undefined {
  if (!coverPath) return undefined;
  const value = coverPath.trim();
  if (!value) return undefined;
  if (isEphemeralCoverUrl(value)) return value;
  return isServerCoverUrl(value) ? value : undefined;
}

/**
 * True when a cover still has to be resolved to a real server URL before it
 * can reach the Lock Screen / Dynamic Island or survive an app relaunch.
 */
export function needsDurableCover(
  coverPath: string | null | undefined,
): boolean {
  const value = coverPath?.trim();
  if (!value) return true;
  if (isEphemeralCoverUrl(value)) return true;
  return !isServerCoverUrl(value);
}

/** Drop covers that cannot outlive this document before persisting/syncing. */
export function durableCoverPath(
  coverPath: string | null | undefined,
): string | null {
  const value = coverPath?.trim();
  if (!value || isEphemeralCoverUrl(value)) return null;
  return isServerCoverUrl(value) ? value : null;
}
