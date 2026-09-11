import { getAuthUserFromRequest, json } from "@/lib/api";
import {
  heartbeatDevice,
  snapshotConnect,
  subscribeConnect,
  type ConnectDeviceKind,
} from "@/lib/player-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = new Set<ConnectDeviceKind>(["phone", "tablet", "computer"]);

/**
 * Server-Sent Events stream for Polarr Connect.
 * Uses fetch+ReadableStream (not EventSource) so native Bearer auth works.
 * Writes still go through POST /api/player/sync.
 */
export async function GET(req: Request) {
  const user = getAuthUserFromRequest(req);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const deviceId = (url.searchParams.get("deviceId") || "").trim().slice(0, 128);
  const name = (url.searchParams.get("name") || "Device").trim().slice(0, 80);
  const kindRaw = (url.searchParams.get("kind") || "computer").trim();
  const kind = (KINDS.has(kindRaw as ConnectDeviceKind)
    ? kindRaw
    : "computer") as ConnectDeviceKind;

  if (!deviceId) {
    return json({ error: "deviceId required" }, { status: 400 });
  }

  heartbeatDevice(user.id, { id: deviceId, name: name || "Device", kind });

  const encoder = new TextEncoder();
  let closed = false;
  let unsub: (() => void) | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        unsub?.();
        unsub = null;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Initial snapshot (also drains any queued commands).
      push(snapshotConnect(user.id, deviceId));

      unsub = subscribeConnect(user.id, deviceId, (snapshot) => {
        push(snapshot);
      });

      // Wire keepalive only — do not refresh lastSeen. Otherwise a frozen
      // background WebView with an open SSE socket stays "online" forever and
      // other clients keep showing "Playing on …" for a dead session.
      pingTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 10_000);

      req.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      if (pingTimer) clearInterval(pingTimer);
      unsub?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
