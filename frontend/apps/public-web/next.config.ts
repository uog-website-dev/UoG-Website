import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile the shared workspace packages (TS sources).
  transpilePackages: ["@uog/ui", "@uog/types", "@uog/api-client"],
};

export default nextConfig;
