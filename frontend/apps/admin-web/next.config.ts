import type { NextConfig } from "next";

import { APP_BASE_PATH } from "./src/base-path";

const nextConfig: NextConfig = {
  // The admin console is served under /admin by the nginx reverse proxy.
  basePath: APP_BASE_PATH,
  // Dev compiles each screen the first time it is opened. The default cache
  // keeps only a couple of those screens, so moving between menus compiles
  // them again. Hold the console's screens for the session.
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    pagesBufferLength: 20,
  },
  // Serve /admin/ as well as /admin. Without this Next.js answers /admin/
  // with a redirect to /admin, which nginx would answer with a redirect back
  // to /admin/ — an endless loop.
  skipTrailingSlashRedirect: true,
  transpilePackages: ["@uog/ui", "@uog/types", "@uog/api-client"],
};

export default nextConfig;
