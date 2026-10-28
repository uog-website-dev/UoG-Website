import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app tsconfig keeps `jsx: "preserve"` for Next.js; the oxc transform
  // (Vite 8) would honour that and fail on TSX, so ask for React's
  // automatic runtime explicitly for tests.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    // Mirror the `@/*` path alias from tsconfig.json.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    server: {
      deps: {
        // Auth.js (`next-auth`) is ESM and imports `next/server`, which Node's
        // native resolver cannot map without Next's bundler. Transform it
        // through Vite instead so the OIDC route tests can drive it.
        inline: ["next-auth", "@auth/core"],
      },
    },
  },
});
