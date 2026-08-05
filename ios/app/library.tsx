import { useCallback, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Pressable,
  Alert,
  RefreshControl,
} from "react-native";
import { Audio } from "expo-av";
import { useFocusEffect } from "expo-router";
import {
  fetchLibrary,
  getServerUrl,
  getToken,
  streamUrl,
  type Track,
} from "@/lib/api";
import { downloadForOffline, getOfflineUri } from "@/lib/offline";

export default function LibraryScreen() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchLibrary();
      setTracks(data.tracks || []);
    } catch (err) {
      Alert.alert(
        "Library error",
        err instanceof Error ? err.message : "Could not load library",
      );
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        void sound?.unloadAsync();
      };
    }, [load, sound]),
  );

  async function play(track: Track) {
    try {
      if (sound) await sound.unloadAsync();
      const offline = await getOfflineUri(track.id);
      const base = await getServerUrl();
      const token = await getToken();
      const uri = offline || streamUrl(base, track.id);
      const { sound: next } = await Audio.Sound.createAsync(
        {
          uri,
          headers: !offline && token ? { Authorization: `Bearer ${token}` } : {},
        },
        { shouldPlay: true },
      );
      setSound(next);
    } catch (err) {
      Alert.alert(
        "Playback failed",
        err instanceof Error ? err.message : "Could not play track",
      );
    }
  }

  async function saveOffline(track: Track) {
    try {
      await downloadForOffline(track);
      Alert.alert("Saved offline", track.title);
    } catch (err) {
      Alert.alert(
        "Offline download failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor="#e11d2e"
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            No tracks on the server yet. Request music from the Polarr web UI.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.meta}>
                {item.artist} · {item.album}
              </Text>
            </View>
            <Pressable style={styles.chip} onPress={() => play(item)}>
              <Text style={styles.chipText}>Play</Text>
            </Pressable>
            <Pressable
              style={[styles.chip, styles.chipGhost]}
              onPress={() => saveOffline(item)}
            >
              <Text style={styles.chipGhostText}>Offline</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0c0f12" },
  empty: { color: "#8b99a6", padding: 24, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1a222a",
  },
  title: { color: "#eef2f4", fontWeight: "600" },
  meta: { color: "#8b99a6", fontSize: 13, marginTop: 2 },
  chip: {
    backgroundColor: "#e11d2e",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chipText: { color: "#ffffff", fontWeight: "700", fontSize: 12 },
  chipGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#24303a",
  },
  chipGhostText: { color: "#eef2f4", fontWeight: "600", fontSize: 12 },
});
