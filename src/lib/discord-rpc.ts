/**
 * Browser Discord Rich Presence via local Discord desktop RPC (ports 6463–6472).
 * Shows “Listening to …” style activity when Discord is open on the same machine.
 */

type ActivityPayload = {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string | null;
};

type RpcMessage = {
  cmd?: string;
  evt?: string;
  nonce?: string;
  data?: unknown;
};

const PORTS = [6463, 6464, 6465, 6466, 6467, 6468, 6469, 6470, 6471, 6472];

let socket: WebSocket | null = null;
let clientId = "";
let ready = false;
let connecting: Promise<boolean> | null = null;
let nonceCounter = 0;

function nextNonce() {
  nonceCounter += 1;
  return `polarr-${Date.now()}-${nonceCounter}`;
}

function send(payload: Record<string, unknown>) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function closeSocket() {
  ready = false;
  connecting = null;
  if (socket) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }
  socket = null;
}

function connectPort(port: number, appId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}/?v=1&encoding=json`);
    } catch {
      finish(false);
      return;
    }

    const timer = window.setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      finish(false);
    }, 1200);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          v: 1,
          client_id: appId,
        }),
      );
    });

    ws.addEventListener("message", (ev) => {
      let msg: RpcMessage;
      try {
        msg = JSON.parse(String(ev.data)) as RpcMessage;
      } catch {
        return;
      }
      if (msg.cmd === "DISPATCH" && msg.evt === "READY") {
        window.clearTimeout(timer);
        socket = ws;
        ready = true;
        finish(true);
      }
    });

    ws.addEventListener("error", () => {
      window.clearTimeout(timer);
      finish(false);
    });
    ws.addEventListener("close", () => {
      window.clearTimeout(timer);
      if (socket === ws) {
        socket = null;
        ready = false;
      }
      finish(false);
    });
  });
}

async function ensureConnected(appId: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!appId.trim()) return false;
  if (ready && socket && clientId === appId) return true;
  if (connecting) return connecting;

  clientId = appId.trim();
  closeSocket();

  connecting = (async () => {
    for (const port of PORTS) {
      const ok = await connectPort(port, clientId);
      if (ok) return true;
    }
    return false;
  })();

  const ok = await connecting;
  connecting = null;
  return ok;
}

/** Clear Discord activity. */
export async function clearDiscordActivity() {
  if (!ready || !socket) return;
  send({
    cmd: "SET_ACTIVITY",
    args: { pid: 0, activity: null },
    nonce: nextNonce(),
  });
}

/** Push current track as a Discord Rich Presence activity. */
export async function setDiscordListeningActivity(
  appId: string,
  track: ActivityPayload | null,
): Promise<boolean> {
  if (!track) {
    await clearDiscordActivity();
    return true;
  }
  const ok = await ensureConnected(appId);
  if (!ok) return false;

  const activity: Record<string, unknown> = {
    details: track.title.slice(0, 128),
    state: `by ${track.artist}`.slice(0, 128),
    assets: {
      large_text: (track.album || track.title).slice(0, 128),
    },
    timestamps: { start: Math.floor(Date.now() / 1000) },
    type: 2, // LISTENING
  };

  send({
    cmd: "SET_ACTIVITY",
    args: {
      pid: 0,
      activity,
    },
    nonce: nextNonce(),
  });
  return true;
}

export function discordRpcDisconnect() {
  void clearDiscordActivity();
  closeSocket();
}
