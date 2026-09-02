import desktopPackageJson from "../../apps/desktop/package.json";

export type DesktopRelease = {
  version: string;
  publishedAt: string | null;
  releaseUrl: string;
  macosUrl: string;
  windowsUrl: string;
};

export function desktopReleaseForVersion(
  version = desktopPackageJson.version,
): DesktopRelease {
  const tag = `desktop-v${version}`;
  const base = `https://github.com/KevinGuest/polarr/releases/download/${tag}`;
  return {
    version,
    publishedAt: null,
    releaseUrl: `https://github.com/KevinGuest/polarr/releases/tag/${tag}`,
    macosUrl: `${base}/Polarr_${version}_universal.dmg`,
    windowsUrl: `${base}/Polarr_${version}_x64-setup.exe`,
  };
}

export const FALLBACK_DESKTOP_RELEASE = desktopReleaseForVersion();
