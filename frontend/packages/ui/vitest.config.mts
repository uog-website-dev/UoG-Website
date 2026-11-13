import { defineConfig } from "vitest/config";

export default defineConfig({
  // The package tsconfig does not set a JSX transform for tests, so ask for
  // React's automatic runtime explicitly.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "jsdom",
    // Bound jsdom workers so concurrent workspace tests do not exhaust CI memory.
    maxWorkers: 2,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
