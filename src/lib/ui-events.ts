/** Cross-component UI events (window CustomEvent / Event names). */
export const AVATAR_UPDATED_EVENT = "polarr:avatar-updated";
export const LIKES_CHANGED_EVENT = "polarr:likes-changed";
export const LIBRARY_CHANGED_EVENT = "polarr:library-changed";
/** Fired after a ≥15s listen heartbeat is credited (recent / others feed). */
export const LISTEN_CREDITED_EVENT = "polarr:listen-credited";

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

export function emitListenCredited(detail?: { trackId?: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(LISTEN_CREDITED_EVENT, { detail: detail ?? {} }),
  );
}