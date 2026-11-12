import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

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
    // Keep async UI assertions responsive on shared development/CI machines.
    maxWorkers: 2,
    // MUI dialogs in the Site editors take several seconds under a full
    // suite. The assertions stay; only the wait budget grows.
    testTimeout: 20000,
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
