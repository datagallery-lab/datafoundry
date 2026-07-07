import path from "node:path";
import type { NextConfig } from "next";

const apiProxyTarget = readProxyTarget(
  process.env.API_PROXY_TARGET,
  process.env.NEXT_PUBLIC_CONFIG_API_URL,
  process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL?.replace(/\/api\/copilotkit\/?$/u, ""),
);

function readProxyTarget(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed.replace(/\/$/u, "");
    }
  }
  return "http://127.0.0.1:8787";
}

const workspaceRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  // Dev uses Turbopack (see `dev` script). Declaring this key pins the
  // monorepo root and silences the "Webpack is configured while Turbopack is
  // not" warning; the webpack() hook below still applies to `next build`.
  turbopack: {
    root: workspaceRoot,
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiProxyTarget}/api/v1/:path*`,
      },
      {
        source: "/api/copilotkit/:path*",
        destination: `${apiProxyTarget}/api/copilotkit/:path*`,
      },
      {
        source: "/api/copilotkit",
        destination: `${apiProxyTarget}/api/copilotkit`,
      },
    ];
  },
  webpack(config, { isServer }) {
    if (isServer && config.output) {
      config.output.chunkFilename = "chunks/[name].js";
    }
    return config;
  },
};

export default nextConfig;
