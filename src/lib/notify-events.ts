export type NotifyEventId =
  | "requestNew"
  | "downloadStarted"
  | "requestAvailable"
  | "requestFailed";

export type NotifyEventFlags = Record<NotifyEventId, boolean>;

export const NOTIFY_EVENT_IDS = [
  "requestNew",
  "downloadStarted",
  "requestAvailable",
  "requestFailed",
] as const satisfies readonly NotifyEventId[];

export const DEFAULT_NOTIFY_EVENTS: NotifyEventFlags = {
  requestNew: true,
  downloadStarted: true,
  requestAvailable: true,
  requestFailed: true,
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
