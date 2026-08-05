import { Link } from "expo-router";
import { StyleSheet, Text, View, Pressable } from "react-native";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Polarr</Text>
      <Text style={styles.sub}>
        Spotify-style listening for music on your homeserver.
      </Text>
      <Link href="/connect" asChild>
        <Pressable style={styles.btn}>
          <Text style={styles.btnText}>Connect to server</Text>
        </Pressable>
      </Link>
      <Link href="/library" asChild>
        <Pressable style={[styles.btn, styles.btnGhost]}>
          <Text style={styles.btnGhostText}>Open library</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    gap: 16,
    backgroundColor: "#0c0f12",
  },
  brand: {
    color: "#eef2f4",
    fontSize: 40,
    fontWeight: "700",
  },
  sub: {
    color: "#8b99a6",
    fontSize: 16,
    marginBottom: 12,
  },
  btn: {
    backgroundColor: "#e11d2e",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  btnText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#24303a",
  },
  btnGhostText: {
    color: "#eef2f4",
    fontWeight: "600",
  },
});
