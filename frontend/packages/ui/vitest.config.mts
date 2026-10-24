import { defineConfig } from "vitest/config";

export default defineConfig({
  // The package tsconfig does not set a JSX transform for tests, so ask for
  // React's automatic runtime explicitly.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
