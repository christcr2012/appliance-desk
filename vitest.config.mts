import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    // Most of this repository's tests exercise server/domain code and do not
    // need a browser DOM. Running every file in jsdom made CI construct 143
    // separate DOM environments; on the audited run that was 60% of Vitest's
    // tracked time. Keep backend tests in the safer fork pool and reserve
    // jsdom for actual component/browser-unit tests. The theme logic is the
    // one .test.ts file that intentionally exercises window/document.
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/theme.test.ts"],
          pool: "forks",
        },
      },
      {
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["tests/**/*.test.tsx", "tests/theme.test.ts"],
          setupFiles: ["./tests/setup.ts"],
          // Vitest 5 keeps per-file isolation while reusing the expensive
          // jsdom environment per worker in this pool.
          pool: "vmThreads",
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});