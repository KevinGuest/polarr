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
    // never = webview fills the screen; the web UI pads with safe-area insets.
    // automatic inset the WKWebView and left black bars above/below the app.
    contentInset: "never",
    backgroundColor: "#09090b",
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
