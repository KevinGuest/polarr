/** Cross-component UI events (window CustomEvent / Event names). */
export const AVATAR_UPDATED_EVENT = "polarr:avatar-updated";
export const LIKES_CHANGED_EVENT = "polarr:likes-changed";
export const LIBRARY_CHANGED_EVENT = "polarr:library-changed";
export const LIBRARY_PINS_CHANGED_EVENT = "polarr:library-pins-changed";
/** Fired after a ≥30s listen heartbeat is credited (recent / others feed). */
export const LISTEN_CREDITED_EVENT = "polarr:listen-credited";
export const RECENT_PLAYED_CHANGED_EVENT = "polarr:recent-played-changed";

export function emitLikesChanged(detail?: { count?: number; liked?: boolean }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(LIKES_CHANGED_EVENT, { detail: detail ?? {} }),
  );
}

export function emitLibraryChanged(detail?: { trackId?: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(LIBRARY_CHANGED_EVENT, { detail: detail ?? {} }),
  );
}

export function emitLibraryPinsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIBRARY_PINS_CHANGED_EVENT));
}

export function emitListenCredited(detail?: { trackId?: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(LISTEN_CREDITED_EVENT, { detail: detail ?? {} }),
  );
}