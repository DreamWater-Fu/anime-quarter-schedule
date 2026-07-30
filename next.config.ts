import type { NextConfig } from "next";

const isStaticExport = process.env.NEXT_PUBLIC_STATIC_EXPORT === "true";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  ...(isStaticExport ? { output: "export" as const } : {}),
  ...(isStaticExport && basePath ? { basePath, assetPrefix: basePath } : {}),
  experimental: {
    useTypeScriptCli: true
  }
};

export default nextConfig;
