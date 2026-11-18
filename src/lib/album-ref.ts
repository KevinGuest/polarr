/**
 * Opaque album path ids: /album/{id}
 * Prefer MusicBrainz release-group MBID → ~22-char base62 (Spotify-like).
 * Fallback packs title + artist (+ optional lidarr id) without cover URLs.
 */

const B62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export type AlbumRef = {
  title: string;
  artist: string;
  foreignAlbumId?: string;
  lidarrAlbumId?: number;
};

function base62Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  // Big-endian integer → base62
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const val = digits[i] * 256 + carry;
      digits[i] = val % 62;
      carry = (val / 62) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 62);
      carry = (carry / 62) | 0;
    }
  }
  // Preserve leading zero bytes as leading '0'
  let leading = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    leading += 1;
  }
  let out = "0".repeat(leading);
  for (let i = digits.length - 1; i >= 0; i--) out += B62[digits[i]];
  return out;
}

function base62Decode(str: string): Uint8Array | null {
  if (!str || !/^[0-9A-Za-z]+$/.test(str)) return null;
  const bytes = [0];
  for (const ch of str) {
    const val = B62.indexOf(ch);
    if (val < 0) return null;
    let carry = val;
    for (let i = 0; i < bytes.length; i++) {
      const n = bytes[i] * 62 + carry;
      bytes[i] = n & 0xff;
      carry = n >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leading = 0;
  for (const ch of str) {
    if (ch !== "0") break;
    leading += 1;
  }
  const out = new Uint8Array(leading + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[out.length - 1 - i] = bytes[i];
  }
  return out;
}

function normalizeUuid(raw?: string): string | null {
  if (!raw) return null;
  const hex = raw.trim().toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** UTF-8 bytes truncated to maxLen without splitting a multi-byte char. */
function encodeUtf8Truncated(s: string, maxLen: number): Uint8Array {
  const all = encodeUtf8(s);
  if (all.length <= maxLen) return all;
  let end = maxLen;
  while (end > 0 && (all[end] & 0xc0) === 0x80) end--;
  return all.subarray(0, end);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Encode album identity into a short opaque path segment.
 * Image URLs are intentionally never included.
 *
 * Kind 2 layout (preferred when title+artist known):
 *   kind(1) flags(1) titleLen(1) title artistLen(1) artist
 *   [lidarr u32 if flags&1] [16-byte MBID if flags&2]
 * Kind 1 (MBID-only fallback):
 *   kind(1) uuid(16)
 */
export function encodeAlbumId(ref: AlbumRef): string {
  const mbid = normalizeUuid(ref.foreignAlbumId);
  const title = ref.title.trim();
  const artist = ref.artist.trim();

  // Prefer title+artist so album pages work before the release is in Lidarr.
  if (title && artist) {
    const titleBytes = encodeUtf8Truncated(title, 255);
    const artistBytes = encodeUtf8Truncated(artist, 255);
    const hasLidarr =
      ref.lidarrAlbumId != null && Number.isFinite(ref.lidarrAlbumId) && ref.lidarrAlbumId > 0;
    const hasMbid = Boolean(mbid);
    const flags = (hasLidarr ? 1 : 0) | (hasMbid ? 2 : 0);
    const lidarrExtra = hasLidarr ? 4 : 0;
    const mbidExtra = hasMbid ? 16 : 0;
    const bytes = new Uint8Array(
      4 + titleBytes.length + artistBytes.length + lidarrExtra + mbidExtra,
    );
    let o = 0;
    bytes[o++] = 2;
    bytes[o++] = flags;
    bytes[o++] = titleBytes.length;
    bytes.set(titleBytes, o);
    o += titleBytes.length;
    bytes[o++] = artistBytes.length;
    bytes.set(artistBytes, o);
    o += artistBytes.length;
    if (hasLidarr) {
      const id = ref.lidarrAlbumId!;
      bytes[o++] = (id >>> 24) & 0xff;
      bytes[o++] = (id >>> 16) & 0xff;
      bytes[o++] = (id >>> 8) & 0xff;
      bytes[o++] = id & 0xff;
    }
    if (hasMbid && mbid) {
      bytes.set(uuidToBytes(mbid), o);
    }
    return base62Encode(bytes);
  }

  if (mbid) {
    const bytes = new Uint8Array(17);
    bytes[0] = 1;
    bytes.set(uuidToBytes(mbid), 1);
    return base62Encode(bytes);
  }

  return base62Encode(new Uint8Array([2, 0, 0, 0]));
}

/** Decode an opaque album path id. Returns null if invalid. */
export function decodeAlbumId(id: string): AlbumRef | null {
  const raw = id.trim();
  if (!raw) return null;
  const bytes = base62Decode(raw);
  if (!bytes || bytes.length < 2) return null;

  const kind = bytes[0];
  if (kind === 1) {
    if (bytes.length < 17) return null;
    const foreignAlbumId = bytesToUuid(bytes.subarray(1, 17));
    return { title: "", artist: "", foreignAlbumId };
  }

  if (kind === 2) {
    if (bytes.length < 4) return null;
    let o = 1;
    const flags = bytes[o++];
    const titleLen = bytes[o++];
    if (o + titleLen >= bytes.length) return null;
    const title = decodeUtf8(bytes.subarray(o, o + titleLen));
    o += titleLen;
    if (o >= bytes.length) return null;
    const artistLen = bytes[o++];
    if (o + artistLen > bytes.length) return null;
    const artist = decodeUtf8(bytes.subarray(o, o + artistLen));
    o += artistLen;
    let lidarrAlbumId: number | undefined;
    if ((flags & 1) === 1) {
      if (o + 4 > bytes.length) return null;
      lidarrAlbumId =
        ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
      o += 4;
    }
    let foreignAlbumId: string | undefined;
    if ((flags & 2) === 2) {
      if (o + 16 > bytes.length) return null;
      foreignAlbumId = bytesToUuid(bytes.subarray(o, o + 16));
    }
    if (!title || !artist) return null;
    return { title, artist, lidarrAlbumId, foreignAlbumId };
  }

  return null;
}

/* ───────────────────────────── clean album links ───────────────────────────── */

/**
 * URL slug: lowercase words joined by "-". Letters and digits of any script are
 * kept (accents folded), everything else separates words.
 * "Mr. Morale & the Big Steppers" → "mr-morale-the-big-steppers".
 */
export function slugify(value: string): string {
  return (value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** Best-effort words back from a slug (the server resolves the real names). */
export function deslug(slug: string): string {
  return (slug || "").replace(/-+/g, " ").trim();
}

function slugKey(artistSlug: string, titleSlug: string): string {
  return `${artistSlug}/${titleSlug}`;
}

/**
 * Refs seen while building links this session, so an in-app click still
 * carries the exact Lidarr / MusicBrainz ids that no longer fit in the URL.
 * Browser only — a cold or shared link is resolved from its slugs by the server.
 */
const REMEMBER_MAX = 3000;
const remembered = new Map<string, AlbumRef>();

function remember(key: string, ref: AlbumRef) {
  if (typeof window === "undefined") return;
  const prev = remembered.get(key);
  // Never let a bare title+artist ref overwrite one that carries ids.
  if (
    prev &&
    (prev.foreignAlbumId || prev.lidarrAlbumId) &&
    !ref.foreignAlbumId &&
    !ref.lidarrAlbumId
  ) {
    return;
  }
  if (!prev && remembered.size >= REMEMBER_MAX) {
    const oldest = remembered.keys().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
  remembered.set(key, ref);
}

export type SluggedAlbumRef = AlbumRef & {
  /** Set when the names are only a guess from the URL and need resolving. */
  slugs?: { artist: string; title: string };
};

/** Album identity for /album/{artist-slug}/{title-slug}. */
export function albumRefFromSlugs(artistSlug: string, titleSlug: string): SluggedAlbumRef | null {
  const a = slugify(safeDecode(artistSlug));
  const t = slugify(safeDecode(titleSlug));
  if (!a || !t) return null;
  const known = remembered.get(slugKey(a, t));
  if (known) return known;
  return { artist: deslug(a), title: deslug(t), slugs: { artist: a, title: t } };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Album link. Readable `/album/{artist}/{title}` whenever both names produce a
 * slug; otherwise (symbol-only names, MBID-only refs) the opaque id form, which
 * keeps working for every previously shared link.
 */
export function albumHref(ref: AlbumRef): string {
  const a = slugify(ref.artist);
  const t = slugify(ref.title);
  if (a && t) {
    remember(slugKey(a, t), ref);
    return `/album/${encodeURIComponent(a)}/${encodeURIComponent(t)}`;
  }
  return `/album/${encodeAlbumId(ref)}`;
}
