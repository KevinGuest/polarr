import * as FileSystem from "expo-file-system";
import { getServerUrl, getToken, type Track } from "./api";

const OFFLINE_DIR = `${FileSystem.documentDirectory}offline/`;

export async function ensureOfflineDir() {
  const info = await FileSystem.getInfoAsync(OFFLINE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(OFFLINE_DIR, { intermediates: true });
  }
}

export function offlinePath(trackId: string) {
  return `${OFFLINE_DIR}${trackId}.audio`;
}

export async function downloadForOffline(track: Track) {
  await ensureOfflineDir();
  const base = await getServerUrl();
  const token = await getToken();
  const target = offlinePath(track.id);
  const result = await FileSystem.downloadAsync(
    `${base}/api/stream/${track.id}`,
    target,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  await FileSystem.writeAsStringAsync(
    `${OFFLINE_DIR}${track.id}.json`,
    JSON.stringify(track),
  );
  return result.uri;
}

export async function getOfflineUri(trackId: string) {
  const path = offlinePath(trackId);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? path : null;
}
