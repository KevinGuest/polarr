import { json, requireAuthFromRequest } from "@/lib/api";
import {
  ensureKaraokeInstrumental,
  getKaraokeInfo,
  type KaraokeRequestMeta,
} from "@/lib/karaoke-stems";

export const dynamic = "force-dynamic";

function metaFromUrl(req: Request): KaraokeRequestMeta {
  const url = new URL(req.url);
  return {
    artist: url.searchParams.get("artist") || undefined,
    title: url.searchParams.get("title") || undefined,
    album: url.searchParams.get("album") || undefined,
  };
}

async function metaFromBody(req: Request): Promise<KaraokeRequestMeta> {
  try {
    const body = (await req.json()) as KaraokeRequestMeta;
    return {
      artist: body.artist || undefined,
      title: body.title || undefined,
      album: body.album || undefined,
    };
  } catch {
    return {};
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireAuthFromRequest(req);
  if (auth.response) return auth.response;

  const { id } = await ctx.params;
  if (!id) return json({ error: "Missing track id" }, { status: 400 });
  return json(getKaraokeInfo(id, metaFromUrl(req)));
}

/** Start / ensure stem separation for an on-disk library file. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = requireAuthFromRequest(req);
  if (auth.response) return auth.response;

  const { id } = await ctx.params;
  if (!id) return json({ error: "Missing track id" }, { status: 400 });
  const meta = await metaFromBody(req);
  return json(ensureKaraokeInstrumental(id, meta));
}
