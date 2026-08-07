import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "demucs", "onnxruntime-node"],
};

export default nextConfig;
