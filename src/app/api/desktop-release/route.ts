import { json } from "@/lib/api";
import {
  FALLBACK_DESKTOP_RELEASE,
  desktopReleaseForVersion,
} from "@/lib/desktop-release";

const UPDATER_MANIFEST =
  "https://github.com/KevinGuest/polarr/releases/latest/download/latest.json";

type UpdaterManifest = {
  version?: unknown;
  pub_date?: unknown;
  platforms?: Record<string, { url?: unknown }>;
};

export async function GET() {
  try {
    const response = await fetch(UPDATER_MANIFEST, {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Release manifest unavailable");

    const manifest = (await response.json()) as UpdaterManifest;
    if (typeof manifest.version !== "string" || !manifest.version.trim()) {
      throw new Error("Release manifest has no version");
    }

    const release = desktopReleaseForVersion(manifest.version.trim());
    const windowsUrl = manifest.platforms?.["windows-x86_64-nsis"]?.url;
    return json(
      {
        ...release,
        publishedAt:
          typeof manifest.pub_date === "string" ? manifest.pub_date : null,
        windowsUrl:
          typeof windowsUrl === "string" ? windowsUrl : release.windowsUrl,
      },
      { headers: { "Cache-Control": "public, max-age=900, stale-while-revalidate=86400" } },
    );
  } catch {
    return json(FALLBACK_DESKTOP_RELEASE, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }
}
