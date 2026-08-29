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
    // Edge-to-edge WebView. CSS env(safe-area-inset-*) pads the notch / home indicator.
    // "automatic" inset the document and made the whole app pan.
    contentInset: "never",
    backgroundColor: "#09090b",
    preferredContentMode: "mobile",
    scrollEnabled: false,
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: {
      backgroundColor: "#09090b",
      launchAutoHide: true,
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#09090b",
      overlaysWebView: true,
    },
  },
};

export default config;
