import { json } from "@/lib/api";
import { desktopServerManifest } from "@/lib/desktop-protocol";

export const dynamic = "force-dynamic";

/** Public compatibility handshake for native Polarr clients. */
export function GET() {
  return json(desktopServerManifest(), {
    headers: { "Cache-Control": "no-store" },
  });
}
