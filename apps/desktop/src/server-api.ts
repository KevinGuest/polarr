import { invoke } from "@tauri-apps/api/core";

export const DESKTOP_PROTOCOL_VERSION = 1;

export type DesktopServerManifest = {
  app: "polarr";
  serverVersion: string;
  protocol: { min: number; max: number };
  capabilities: string[];
  webAppPath: string;
};

export type ServerProbe = {
  url: string;
  manifest: DesktopServerManifest | null;
  legacy: boolean;
};

export type DesktopApiResponse = {
  status: number;
  body: string;
  contentType: string | null;
  etag: string | null;
  location: string | null;
};

export async function probePolarrServer(url: string): Promise<ServerProbe> {
  return invoke<ServerProbe>("probe_server", { url });
}

/**
 * Data transport for screens migrated into the bundled desktop UI. Cookies
 * remain in Rust, avoiding cross-origin browser/CORS differences on LAN HTTP.
 */
export async function desktopApiRequest(
  path: string,
  init: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    accept?: string;
    etag?: string;
  } = {},
): Promise<DesktopApiResponse> {
  const hasBody = init.body !== undefined;
  return invoke<DesktopApiResponse>("desktop_api_request", {
    request: {
      method: init.method ?? "GET",
      path,
      body: hasBody ? JSON.stringify(init.body) : null,
      contentType: hasBody ? "application/json" : null,
      accept: init.accept ?? "application/json",
      ifNoneMatch: init.etag ?? null,
    },
  });
}

export async function desktopApiJson<T>(
  path: string,
  init: Parameters<typeof desktopApiRequest>[1] = {},
): Promise<T> {
  const response = await desktopApiRequest(path, init);
  let data: unknown = null;
  try {
    data = response.body ? JSON.parse(response.body) : null;
  } catch {
    throw new Error(`Polarr server returned invalid JSON (${response.status})`);
  }
  if (response.status < 200 || response.status >= 300) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Polarr server request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

export function resetDesktopApiSession(): Promise<void> {
  return invoke("desktop_api_reset_session");
}
