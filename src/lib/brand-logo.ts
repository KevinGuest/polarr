import fs from "node:fs";
import path from "node:path";
import { getSettings, type Settings } from "@/lib/db";
import {
  POLARR_LOGO_CID,
  POLARR_LOGO_PUBLIC_URL,
} from "@/lib/email-templates";
import { resolvePublicBaseUrl } from "@/lib/public-url";

export { POLARR_LOGO_CID, POLARR_LOGO_PUBLIC_URL };

export function resolveBrandLogoFile(): string | null {
  const candidates = [
    path.join(process.cwd(), "public", "polarr-icon.png"),
    path.join(process.cwd(), "app", "public", "polarr-icon.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Absolute https URL for previews / clients that prefer remote images. */
export function resolveBrandLogoUrl(settings?: Settings): string {
  const s = settings ?? getSettings();
  const base = resolvePublicBaseUrl(s);
  if (base) return `${base}/polarr-icon.png`;
  return POLARR_LOGO_PUBLIC_URL;
}

/**
 * Logo URL for HTML email bodies.
 * Prefer CID (embedded) so it shows without depending on Public URL reachability.
 */
export function emailLogoSrc(opts?: {
  preferRemote?: boolean;
  settings?: Settings;
}): string {
  if (opts?.preferRemote) return resolveBrandLogoUrl(opts.settings);
  const file = resolveBrandLogoFile();
  if (file) return `cid:${POLARR_LOGO_CID}`;
  return resolveBrandLogoUrl(opts?.settings);
}

export function brandLogoAttachment():
  | {
      filename: string;
      path: string;
      cid: string;
      contentType: string;
      contentDisposition: "inline";
    }
  | null {
  const file = resolveBrandLogoFile();
  if (!file) return null;
  return {
    filename: "polarr-icon.png",
    path: file,
    cid: POLARR_LOGO_CID,
    contentType: "image/png",
    contentDisposition: "inline",
  };
}

/** Display name for the From header (inbox “contact” name). */
export function emailFromAddress(
  settings: Settings,
): { name: string; address: string } {
  return {
    name: settings.serverName.trim() || "Polarr",
    address: settings.smtpFrom.trim(),
  };
}
