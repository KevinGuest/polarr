/**
 * In-memory Spotify-style Connect session per signed-in user.
 * Single-process Docker/Umbrel — heartbeats keep devices online.
 * SSE subscribers get pushed snapshots when state/commands change.
 */

export type ConnectDeviceKind = "phone" | "tablet" | "computer";

export type ConnectTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverPath?: string | null;
  streamUrl?: string | null;
  explicit?: boolean;
  quality?: "local" | "youtube" | null;
  resolveArtist?: string | null;
  duration?: number | null;
};

export type ConnectPlaybackState = {
  track: ConnectTrack | null;
  queue: ConnectTrack[];
  playing: boolean;
  progress: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  /** Device that currently outputs audio. */
  ownerId: string | null;
  updatedAt: number;
};

export type ConnectDevice = {
  id: string;
  name: string;
  kind: ConnectDeviceKind;
  lastSeen: number;
};

export type ConnectCommand =
  | { id: string; type: "play" }
  | { id: string; type: "pause" }
  | { id: string; type: "toggle" }
  | { id: string; type: "seek"; progress: number }
  | { id: string; type: "next" }
  | { id: string; type: "prev" }
  | { id: string; type: "volume"; volume: number }
  | { id: string; type: "shuffle" }
  | {
      id: string;
      type: "play-track";
      track: ConnectTrack;
      queue?: ConnectTrack[];
    }
  | { id: string; type: "become-owner" }
  | { id: string; type: "release" };

export type ConnectSnapshot = {
  devices: ConnectDevice[];
  state: ConnectPlaybackState | null;
  commands: ConnectCommand[];
};

/** Long enough for SSE keepalive (~10s) without dropping devices. */
const DEVICE_TTL_MS = 40_000;
const MAX_COMMANDS = 24;

type UserSession = {
  devices: Map<string, ConnectDevice>;
  state: ConnectPlaybackState | null;
  commands: Map<string, ConnectCommand[]>;
  /** Remote volume tweak awaiting owner apply — shields against stale heartbeats. */
  pendingVolume: { volume: number; at: number } | null;
};

type ConnectSubscriber = {
  deviceId: string;
  /** Skip this device when fanout originates from its own POST. */
  send: (snapshot: ConnectSnapshot) => void;
};

const g = globalThis as typeof globalThis & {
  __polarrConnect?: Map<string, UserSession>;
  __polarrConnectSubs?: Map<string, Set<ConnectSubscriber>>;
};

function store(): Map<string, UserSession> {
  if (!g.__polarrConnect) g.__polarrConnect = new Map();
  return g.__polarrConnect;
}

function subscribers(): Map<string, Set<ConnectSubscriber>> {
  if (!g.__polarrConnectSubs) g.__polarrConnectSubs = new Map();
  return g.__polarrConnectSubs;
}

function sessionFor(userId: string): UserSession {
  const sessions = store();
  let session = sessions.get(userId);
  if (!session) {
    session = {
      devices: new Map(),
      state: null,
      commands: new Map(),
      pendingVolume: null,
    };
    sessions.set(userId, session);
  }
  return session;
}

function prune(session: UserSession, now = Date.now()) {
  for (const [id, device] of session.devices) {
    if (now - device.lastSeen > DEVICE_TTL_MS) {
      session.devices.delete(id);
      session.commands.delete(id);
      if (session.state?.ownerId === id) {
        session.state = {
          ...session.state,
          playing: false,
          ownerId: null,
          updatedAt: now,
        };
      }
    }
  }
}

function enqueue(session: UserSession, deviceId: string, command: ConnectCommand) {
  const list = session.commands.get(deviceId) ?? [];
  list.push(command);
  if (list.length > MAX_COMMANDS) list.splice(0, list.length - MAX_COMMANDS);
  session.commands.set(deviceId, list);
}

function takeCommands(session: UserSession, deviceId: string): ConnectCommand[] {
  const list = session.commands.get(deviceId) ?? [];
  session.commands.set(deviceId, []);
  return list;
}

/**
 * Push a fresh per-device snapshot to all SSE listeners.
 * @param exceptDeviceId Skip the device that already received the POST response.
 */
export function notifyConnect(userId: string, exceptDeviceId?: string): void {
  const subs = subscribers().get(userId);
  if (!subs || subs.size === 0) return;
  for (const sub of [...subs]) {
    if (exceptDeviceId && sub.deviceId === exceptDeviceId) continue;
    try {
      sub.send(snapshotConnect(userId, sub.deviceId));
    } catch {
      subs.delete(sub);
    }
  }
}

export function subscribeConnect(
  userId: string,
  deviceId: string,
  send: (snapshot: ConnectSnapshot) => void,
): () => void {
  const all = subscribers();
  let set = all.get(userId);
  if (!set) {
    set = new Set();
    all.set(userId, set);
  }
  const sub: ConnectSubscriber = { deviceId, send };
  set.add(sub);
  return () => {
    set!.delete(sub);
    if (set!.size === 0) all.delete(userId);
  };
}

export function heartbeatDevice(
  userId: string,
  device: { id: string; name: string; kind: ConnectDeviceKind },
): ConnectDevice {
  const session = sessionFor(userId);
  const now = Date.now();
  prune(session, now);
  const next: ConnectDevice = {
    id: device.id.trim().slice(0, 128),
    name: device.name.trim().slice(0, 80) || "Device",
    kind: device.kind,
    lastSeen: now,
  };
  session.devices.set(next.id, next);
  return next;
}

export function publishConnectState(
  userId: string,
  deviceId: string,
  state: Omit<ConnectPlaybackState, "ownerId" | "updatedAt"> & {
    ownerId?: string | null;
  },
): ConnectPlaybackState {
  const session = sessionFor(userId);
  const now = Date.now();
  prune(session, now);

  let volume = Number.isFinite(state.volume) ? state.volume : 0.8;
  const pending = session.pendingVolume;
  if (pending && now - pending.at < 8_000) {
    if (Math.abs(volume - pending.volume) < 0.02) {
      session.pendingVolume = null;
    } else {
      // Owner heartbeat still has pre-command volume — keep the remote tweak.
      volume = pending.volume;
    }
  }

  const next: ConnectPlaybackState = {
    track: state.track,
    queue: Array.isArray(state.queue) ? state.queue.slice(0, 80) : [],
    playing: Boolean(state.playing),
    progress: Number.isFinite(state.progress) ? state.progress : 0,
    duration: Number.isFinite(state.duration) ? state.duration : 0,
    volume,
    shuffle: Boolean(state.shuffle),
    ownerId: deviceId,
    updatedAt: now,
  };
  session.state = next;
  return next;
}

export function enqueueConnectCommand(
  userId: string,
  fromDeviceId: string,
  command: ConnectCommand,
): void {
  const session = sessionFor(userId);
  prune(session);
  if (command.type === "become-owner" || command.type === "release") {
    return;
  }

  if (command.type === "volume") {
    const volume = Math.max(0, Math.min(1, command.volume));
    const now = Date.now();
    if (session.state) {
      session.state = {
        ...session.state,
        volume,
        updatedAt: now,
      };
    }
    session.pendingVolume = { volume, at: now };
  }

  if (command.type === "play-track") {
    const ownerId = session.state?.ownerId;
    const target = ownerId && session.devices.has(ownerId) ? ownerId : fromDeviceId;
    if (target === fromDeviceId) {
      session.state = {
        track: command.track,
        queue: command.queue ?? session.state?.queue ?? [],
        playing: true,
        progress: 0,
        duration: command.track.duration ?? session.state?.duration ?? 0,
        volume: session.state?.volume ?? 0.8,
        shuffle: session.state?.shuffle ?? false,
        ownerId: fromDeviceId,
        updatedAt: Date.now(),
      };
      enqueue(session, fromDeviceId, {
        id: `own-${Date.now()}`,
        type: "become-owner",
      });
      return;
    }
    enqueue(session, target, command);
    return;
  }

  const ownerId = session.state?.ownerId;
  if (ownerId && ownerId !== fromDeviceId && session.devices.has(ownerId)) {
    enqueue(session, ownerId, command);
    return;
  }

  if (ownerId === fromDeviceId || !ownerId) {
    enqueue(session, fromDeviceId, command);
  }
}

export function transferPlayback(
  userId: string,
  fromDeviceId: string,
  targetId: string,
): void {
  const session = sessionFor(userId);
  prune(session);
  if (!session.devices.has(targetId)) return;

  const prevOwner = session.state?.ownerId ?? fromDeviceId;
  if (session.state) {
    session.state = {
      ...session.state,
      ownerId: targetId,
      updatedAt: Date.now(),
    };
  } else {
    session.state = {
      track: null,
      queue: [],
      playing: false,
      progress: 0,
      duration: 0,
      volume: 0.8,
      shuffle: false,
      ownerId: targetId,
      updatedAt: Date.now(),
    };
  }

  if (prevOwner && prevOwner !== targetId) {
    enqueue(session, prevOwner, {
      id: `rel-${Date.now()}`,
      type: "release",
    });
  }
  enqueue(session, targetId, {
    id: `own-${Date.now()}`,
    type: "become-owner",
  });
}

export function snapshotConnect(
  userId: string,
  deviceId: string,
): ConnectSnapshot {
  const session = sessionFor(userId);
  prune(session);
  return {
    devices: [...session.devices.values()].sort(
      (a, b) => b.lastSeen - a.lastSeen,
    ),
    state: session.state,
    commands: takeCommands(session, deviceId),
  };
}
