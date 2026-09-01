import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Permissions-Policy",
            value: "speaker-selection=(self)",
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
