import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const SHARED_SETTINGS_TESTS = [
  "tests/agreements-term-integration.test.ts",
  "tests/settings-integration.test.ts",
  "tests/settings-terms-policy-integration.test.ts",
  "tests/tax-rate-columns-sync-integration.test.ts",
  "tests/tax-rate-storage.test.ts",
];

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
          exclude: ["tests/theme.test.ts", ...SHARED_SETTINGS_TESTS],
          pool: "forks",
        },
      },
      {
        // These real-database tests all rewrite the ONE business-settings row
        // (policy, tax rate), so they must not run at the same time or they
        // overwrite each other's values. Which runner a file lands on in CI
        // changes whenever tests are added, so this is enforced here, not by
        // luck. Add a new test to this list if it writes that row.
        test: {
          name: "node-shared-settings",
          environment: "node",
          include: SHARED_SETTINGS_TESTS,
          pool: "forks",
          fileParallelism: false,
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