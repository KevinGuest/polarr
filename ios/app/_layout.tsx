import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#0c0f12" },
          headerTintColor: "#eef2f4",
          contentStyle: { backgroundColor: "#0c0f12" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Polarr" }} />
        <Stack.Screen name="connect" options={{ title: "Connect" }} />
        <Stack.Screen name="library" options={{ title: "Library" }} />
      </Stack>
    </>
  );
}
