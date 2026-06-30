import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  webpack(config, { isServer }) {
    if (isServer && config.output) {
      config.output.chunkFilename = "chunks/[name].js";
    }
    return config;
  },
};

export default nextConfig;
