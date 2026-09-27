import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Logs in once per role (if the test-only account env vars are set)
  // and saves the session, so authenticated tests reuse it instead of
  // each one logging in for real — see e2e/global-setup.ts.
  globalSetup: "./e2e/global-setup",
  // In CI, also emit GitHub Actions annotations (file/line + the actual
  // assertion failure) for every failing test — this is what shows up
  // via the Checks API's annotations endpoint, which is reachable even
  // in environments that can't fetch the raw job log or the html report
  // artifact (both are served from a blob-storage redirect that isn't
  // always reachable). Locally, keep the plain list reporter only.
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"]],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  use: {
    baseURL: "http://localhost:3000",
  },
});
