import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const SHARED_SETTINGS_TESTS = [
  "tests/agreements-term-integration.test.ts",
  "tests/settings-integration.test.ts",
  "tests/sms-activation-integration.test.ts",
  "tests/settings-terms-policy-integration.test.ts",
  "tests/recommended-terms-integration.test.ts",
  "tests/customer-email-switch-integration.test.ts",
  "tests/agreements-auto-renew-and-termination-integration.test.ts",
  "tests/notices-state-integration.test.ts",
  "tests/notices-hand-delivery-integration.test.ts",
  "tests/month-to-month-end-integration.test.ts",
  "tests/month-to-month-terms-integration.test.ts",
  "tests/annual-reminders-integration.test.ts",
  "tests/early-return-integration.test.ts",
  "tests/tax-rate-columns-sync-integration.test.ts",
  "tests/tax-rate-storage.test.ts",
  "tests/documents-artifacts.test.ts",
  "tests/agreement-estimate-concurrency-integration.test.ts",
  "tests/billing-subscription-renewal-integration.test.ts",
  "tests/tax-readiness-integration.test.ts",
  "tests/tax-migration-integration.test.ts",
  "tests/tax-locations-integration.test.ts",
  "tests/tax-use-tax-integration.test.ts",
  // Added 2026-10-09: every other real-database test that writes the business-settings row or creates Colorado filing
  // accounts (which filing reminders, the tax overview and the health sweep read across the whole database).
  // tests/shared-state-tests-listed.test.ts fails if a new one is missing.
  "tests/appliance-acquisition-tax-integration.test.ts",
  "tests/automation-runs-integration.test.ts",
  "tests/batch-b2-migration-integration.test.ts",
  "tests/business-tax-address-confirm-integration.test.ts",
  "tests/communications-intent-integration.test.ts",
  "tests/job-scheduling-integration.test.ts",
  "tests/job-scope-integration.test.ts",
  "tests/purchase-tax-recalculate-integration.test.ts",
  "tests/rdf-filing-integration.test.ts",
  "tests/rdf-threshold-integration.test.ts",
  "tests/retail-delivery-fee-integration.test.ts",
  "tests/subscription-end-integration.test.ts",
  "tests/system-issue-sweep-integration.test.ts",
  "tests/tax-filing-finalization-integration.test.ts",
  "tests/tax-filing-integration.test.ts",
  "tests/tax-filing-reminders-integration.test.ts",
  "tests/tax-invoice-lines-integration.test.ts",
  "tests/tax-official-rate-auto-apply-integration.test.ts",
  "tests/tax-overview.test.ts",
  "tests/tax-return-actions-integration.test.ts",
  "tests/tax-setup-actions-integration.test.ts",
  "tests/tax-setup-review-integration.test.ts",
  "tests/two-factor-enforcement-integration.test.ts",
  "tests/voice-webhooks-integration.test.ts",
  "tests/use-tax-frequency-transition-integration.test.ts",
  "tests/use-tax-unlinked-account-integration.test.ts",
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
        // These real-database tests share records that exist once for the whole
        // database — the ONE business-settings row (policy, tax rate, paused
        // automations) and the Colorado filing accounts/periods that reminders,
        // the tax overview and the health sweep read across all rows — so they
        // must not run at the same time or they see and overwrite each other's
        // data. Which runner a file lands on in CI changes whenever tests are
        // added, so this is enforced here, not by luck, and checked by
        // tests/shared-state-tests-listed.test.ts.
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
