import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        // Service worker must revalidate every load so updates roll out.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, max-age=0" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          {
            key: "Permissions-Policy",
            value: "speaker-selection=(self)",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
  serverExternalPackages: [
    "better-sqlite3",
    "demucs",
    "onnxruntime-node",
    "onnxruntime-common",
  ],
};

export default nextConfig;
