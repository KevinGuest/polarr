/**
 * Compatibility contract between independently released Polarr servers and
 * desktop clients. Increment only when the desktop-facing contract makes a
 * breaking change; ordinary server and UI releases do not change it.
 */
export const DESKTOP_PROTOCOL_MIN = 1;
export const DESKTOP_PROTOCOL_MAX = 1;

export const DESKTOP_CAPABILITIES = [
  "web-app",
  "native-api-transport",
  "auth.password",
  "auth.discord",
  "library",
  "search",
  "streaming",
  "playlists",
  "profiles",
  "requests",
  "notifications",
  "admin",
  "discord.rich-presence",
] as const;

export type DesktopServerManifest = {
  app: "polarr";
  serverVersion: string;
  protocol: {
    min: number;
    max: number;
  };
  capabilities: string[];
  webAppPath: string;
};

export function desktopServerManifest(): DesktopServerManifest {
  return {
    app: "polarr",
    serverVersion: process.env.POLARR_APP_VERSION || "0.6.21",
    protocol: {
      min: DESKTOP_PROTOCOL_MIN,
      max: DESKTOP_PROTOCOL_MAX,
    },
    capabilities: [...DESKTOP_CAPABILITIES],
    webAppPath: "/",
  };
}
