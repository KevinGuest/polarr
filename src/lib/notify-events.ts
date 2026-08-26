export type NotifyEventId =
  | "requestNew"
  | "downloadStarted"
  | "requestAvailable"
  | "requestFailed"
  | "passwordResetRequested"
  | "passwordResetCompleted"
  | "inviteCreated"
  | "inviteUsed"
  | "userBanned"
  | "userUnbanned"
  | "trackAdded"
  | "userLogin"
  | "userLogout"
  | "streamError";

export type NotifyEventFlags = Record<NotifyEventId, boolean>;

export const NOTIFY_EVENT_IDS = [
  "requestNew",
  "downloadStarted",
  "requestAvailable",
  "requestFailed",
  "passwordResetRequested",
  "passwordResetCompleted",
  "inviteCreated",
  "inviteUsed",
  "userBanned",
  "userUnbanned",
  "trackAdded",
  "userLogin",
  "userLogout",
  "streamError",
] as const satisfies readonly NotifyEventId[];

export const DEFAULT_NOTIFY_EVENTS: NotifyEventFlags = {
  requestNew: true,
  downloadStarted: true,
  requestAvailable: true,
  requestFailed: true,
  passwordResetRequested: true,
  passwordResetCompleted: true,
  inviteCreated: true,
  inviteUsed: true,
  userBanned: true,
  userUnbanned: true,
  trackAdded: true,
  userLogin: true,
  userLogout: true,
  streamError: true,
};

export const NOTIFY_EVENTS: {
  id: NotifyEventId;
  label: string;
  description: string;
}[] = [
  {
    id: "requestNew",
    label: "New request",
    description: "When someone requests an artist, album, or track.",
  },
  {
    id: "downloadStarted",
    label: "Download started",
    description: "When Lidarr or acquire begins fetching music.",
  },
  {
    id: "requestAvailable",
    label: "Ready to stream",
    description: "When a request lands in the library and can be played.",
  },
  {
    id: "requestFailed",
    label: "Download failed",
    description: "When a request or acquire job fails.",
  },
  {
    id: "passwordResetRequested",
    label: "Password reset requested",
    description: "When someone asks for a forgot-password email.",
  },
  {
    id: "passwordResetCompleted",
    label: "Password changed",
    description: "When a password is updated via a reset link.",
  },
  {
    id: "inviteCreated",
    label: "Invite created",
    description: "When an admin creates an invite code.",
  },
  {
    id: "inviteUsed",
    label: "Invite used",
    description: "When someone joins with an invite code.",
  },
  {
    id: "userBanned",
    label: "User banned",
    description: "When a ban is placed on an account.",
  },
  {
    id: "userUnbanned",
    label: "User unbanned",
    description: "When a ban is lifted.",
  },
  {
    id: "trackAdded",
    label: "Tracks added",
    description: "When new tracks are indexed into the library.",
  },
  {
    id: "userLogin",
    label: "User signed in",
    description: "When someone signs in (password or Discord).",
  },
  {
    id: "userLogout",
    label: "User signed out",
    description: "When someone signs out.",
  },
  {
    id: "streamError",
    label: "Stream error",
    description: "When playback hits a missing file or live stream failure.",
  },
];

export function parseNotifyEvents(raw: string | null | undefined): NotifyEventFlags {
  const next = { ...DEFAULT_NOTIFY_EVENTS };
  if (!raw?.trim()) return next;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    for (const id of NOTIFY_EVENT_IDS) {
      if (typeof parsed[id] === "boolean") next[id] = parsed[id];
    }
  } catch {
    /* keep defaults */
  }
  return next;
}

export function serializeNotifyEvents(flags: NotifyEventFlags): string {
  return JSON.stringify(flags);
}
