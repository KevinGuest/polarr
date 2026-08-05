import {
  createCipheriv,
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from "node:crypto";

const VERSION = "v1";

function secretKey(): Buffer {
  const material =
    process.env.POLARR_ID_SECRET ||
    process.env.POLARR_SECRET ||
    "polarr-local-user-id-scramble";
  return createHash("sha256").update(material).digest();
}

/** Deterministic opaque id for use in public/admin URL paths. */
export function scrambleUserId(userId: string): string {
  const id = userId.trim();
  if (!id) return "";
  const key = secretKey();
  // Fixed IV from secret+id so avatar URLs stay stable for a given user
  const iv = createHash("sha256")
    .update(key)
    .update("polarr-user-iv")
    .update(id)
    .digest()
    .subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(id, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, enc]).toString("base64url");
  return `${VERSION}.${packed}`;
}

/** Resolve scrambled public id back to internal user id, or null if invalid. */
export function unscrambleUserId(token: string | null | undefined): string | null {
  if (!token) return null;
  const raw = token.trim();
  if (!raw) return null;

  // Allow raw internal ids for local tooling / legacy links
  if (!raw.startsWith(`${VERSION}.`) && !raw.includes(".")) {
    if (/^[a-zA-Z0-9_-]{8,64}$/.test(raw)) return raw;
  }

  const [ver, packed] = raw.split(".");
  if (ver !== VERSION || !packed) return null;

  try {
    const buf = Buffer.from(packed, "base64url");
    if (buf.length < 12 + 16 + 1) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
    decipher.setAuthTag(tag);
    const id = Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]).toString("utf8");
    // Verify IV matches expected for this id (catches tampering + mismatch)
    const expectedIv = createHash("sha256")
      .update(secretKey())
      .update("polarr-user-iv")
      .update(id)
      .digest()
      .subarray(0, 12);
    if (iv.length !== expectedIv.length || !timingSafeEqual(iv, expectedIv)) {
      return null;
    }
    return id || null;
  } catch {
    return null;
  }
}
