import * as SecureStore from "expo-secure-store";

const SERVER_KEY = "polarr_server_url";
const TOKEN_KEY = "polarr_token";

export async function getServerUrl() {
  return (await SecureStore.getItemAsync(SERVER_KEY)) || "";
}

export async function setServerUrl(url: string) {
  await SecureStore.setItemAsync(SERVER_KEY, url.replace(/\/+$/, ""));
}

export async function getToken() {
  return (await SecureStore.getItemAsync(TOKEN_KEY)) || "";
}

export async function setToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const base = await getServerUrl();
  if (!base) throw new Error("Server URL not configured");
  const token = await getToken();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return (await res.json()) as T;
}

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
};

export async function login(username: string, password: string) {
  const base = await getServerUrl();
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Login failed");
  await setToken(data.token);
  return data;
}

export async function fetchLibrary() {
  return api<{ tracks: Track[] }>("/api/library");
}

export function streamUrl(base: string, trackId: string) {
  return `${base.replace(/\/+$/, "")}/api/stream/${trackId}`;
}
