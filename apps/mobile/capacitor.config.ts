import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.polarr.mobile",
  appName: "Polarr",
  webDir: "dist",
  server: {
    // Local setup UI first; after connect we navigate the WKWebView to the user's server.
    androidScheme: "https",
    iosScheme: "capacitor",
    allowNavigation: ["*"],
  },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#0c0b12",
    preferredContentMode: "mobile",
    scrollEnabled: true,
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: {
      backgroundColor: "#0c0b12",
      launchAutoHide: true,
    },
  },
};

export default config;
