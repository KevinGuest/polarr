import { useState } from "react";
import { router } from "expo-router";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  Alert,
} from "react-native";
import { login, setServerUrl } from "@/lib/api";

export default function ConnectScreen() {
  const [url, setUrl] = useState("http://");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");

  async function onConnect() {
    try {
      await setServerUrl(url);
      await login(username, password);
      router.replace("/library");
    } catch (err) {
      Alert.alert(
        "Connection failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Homeserver URL</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        value={url}
        onChangeText={setUrl}
        placeholder="http://umbrel.local:3647"
        placeholderTextColor="#5b6a75"
      />
      <Text style={styles.label}>Username</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Pressable style={styles.btn} onPress={onConnect}>
        <Text style={styles.btnText}>Sign in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 10, backgroundColor: "#0c0f12" },
  label: { color: "#8b99a6", marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#24303a",
    borderRadius: 10,
    padding: 12,
    color: "#eef2f4",
    backgroundColor: "#12171c",
  },
  btn: {
    marginTop: 16,
    backgroundColor: "#e11d2e",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  btnText: { color: "#ffffff", fontWeight: "700" },
});
