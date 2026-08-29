import { z } from "zod";
import { getAuthUser, json } from "@/lib/api";
import {
  enqueueConnectCommand,
  heartbeatDevice,
  publishConnectState,
  snapshotConnect,
  transferPlayback,
  type ConnectCommand,
  type ConnectDeviceKind,
  type ConnectTrack,
} from "@/lib/player-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kindSchema = z.enum(["phone", "tablet", "computer"]);

const trackSchema: z.ZodType<ConnectTrack> = z.object({
  id: z.string().min(1).max(400),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  coverPath: z.string().nullable().optional(),
  streamUrl: z.string().nullable().optional(),
  explicit: z.boolean().optional(),
  quality: z.enum(["local", "youtube"]).nullable().optional(),
  resolveArtist: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
});

const stateSchema = z.object({
  track: trackSchema.nullable(),
  queue: z.array(trackSchema).max(80),
  playing: z.boolean(),
  progress: z.number(),
  duration: z.number(),
  volume: z.number(),
  shuffle: z.boolean(),
});

const commandSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1), type: z.literal("play") }),
  z.object({ id: z.string().min(1), type: z.literal("pause") }),
  z.object({ id: z.string().min(1), type: z.literal("toggle") }),
  z.object({
    id: z.string().min(1),
    type: z.literal("seek"),
    progress: z.number(),
  }),
  z.object({ id: z.string().min(1), type: z.literal("next") }),
  z.object({ id: z.string().min(1), type: z.literal("prev") }),
  z.object({
    id: z.string().min(1),
    type: z.literal("volume"),
    volume: z.number(),
  }),
  z.object({ id: z.string().min(1), type: z.literal("shuffle") }),
  z.object({
    id: z.string().min(1),
    type: z.literal("play-track"),
    track: trackSchema,
    queue: z.array(trackSchema).max(80).optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("transfer"),
    targetId: z.string().min(1).max(128),
  }),
]);

const bodySchema = z.object({
  device: z.object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(80),
    kind: kindSchema,
  }),
  state: stateSchema.optional(),
  command: commandSchema.optional(),
});

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const { device, state, command } = parsed.data;
  heartbeatDevice(user.id, {
    id: device.id,
    name: device.name,
    kind: device.kind as ConnectDeviceKind,
  });

  if (state) {
    publishConnectState(user.id, device.id, state);
  }

  if (command) {
    if (command.type === "transfer") {
      transferPlayback(user.id, device.id, command.targetId);
    } else {
      enqueueConnectCommand(user.id, device.id, command as ConnectCommand);
    }
  }

  return json(snapshotConnect(user.id, device.id), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
