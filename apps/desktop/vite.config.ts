import { defineConfig } from "vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  resolve: {
    alias: {
      "@": resolve(__dirname, "../../src"),
      "next/link": resolve(__dirname, "../client/navigation.tsx"),
      "next/navigation": resolve(__dirname, "../client/navigation.tsx"),
    },
    dedupe: ["react", "react-dom"],
  },
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "chrome-menu": resolve(__dirname, "chrome-menu.html"),
        updater: resolve(__dirname, "updater.html"),
      },
    },
  },
});
