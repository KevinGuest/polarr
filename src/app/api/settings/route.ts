import { z } from "zod";
import { json } from "@/lib/api";
import { getSettings, hasUsers, updateSettings } from "@/lib/db";
import { probeLidarr } from "@/lib/lidarr";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = getSettings();
  return json({
    ...settings,
    lidarrApiKey: settings.lidarrApiKey ? "••••••••" : "",
    hasUsers: hasUsers(),
  });
}

const bodySchema = z.object({
  serverName: z.string().min(1).max(80).optional(),
  lidarrUrl: z.string().url().or(z.literal("")).optional(),
  lidarrApiKey: z.string().optional(),
  musicRoot: z.string().optional(),
  fallbackEnabled: z.boolean().optional(),
  publicUrl: z.string().optional(),
  testLidarr: z.boolean().optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const current = getSettings();

  if (body.testLidarr) {
    const url = body.lidarrUrl ?? current.lidarrUrl;
    const key =
      body.lidarrApiKey && body.lidarrApiKey !== "••••••••"
        ? body.lidarrApiKey
        : current.lidarrApiKey;
    try {
      const status = await probeLidarr(url, key);
      return json({ ok: true, status });
    } catch (err) {
      return json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "Connection failed",
        },
        { status: 400 },
      );
    }
  }

  const next = updateSettings({
    serverName: body.serverName ?? current.serverName,
    lidarrUrl: body.lidarrUrl ?? current.lidarrUrl,
    lidarrApiKey:
      body.lidarrApiKey && body.lidarrApiKey !== "••••••••"
        ? body.lidarrApiKey
        : current.lidarrApiKey,
    musicRoot: body.musicRoot ?? current.musicRoot,
    fallbackEnabled: body.fallbackEnabled ?? current.fallbackEnabled,
    publicUrl: body.publicUrl ?? current.publicUrl,
  });

  return json({
    ok: true,
    settings: {
      ...getSettings(),
      lidarrApiKey: next.lidarrApiKey ? "••••••••" : "",
    },
  });
}
