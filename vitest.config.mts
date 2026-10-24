import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const SHARED_SETTINGS_TESTS = [
  "tests/acc2-team-invitations-integration.test.ts", // ACC-2 changes and restores the shared invitation settings.
  "tests/acc3-second-step-integration.test.ts", // ACC-3 changes and restores the shared sign-in method rules and text-code switch.
  "tests/acc4-recovery-integration.test.ts", // ACC-4 changes and restores the shared wrong-password pause numbers and invitation link days.
  "tests/acc5-job-roles-integration.test.ts", // ACC-5 edits the shared starting job roles and the invitation settings.
  "tests/goals-integration.test.ts", // O-5 changes and restores the shared alert settings.
  "tests/approvals-integration.test.ts", // O-3 changes and restores the shared approval limits and settings row.
  "tests/used-appliance-sale-integration.test.ts", // M-2C sets and restores the shared books start date.
  "tests/capabilities-integration.test.ts", // O-2A limits an admin and restores it; reads/writes the shared override table and settings row.
  "tests/settings-undo-integration.test.ts", // O-1 changes and restores shared BusinessSettings fields and reads the settings audit history.
  "tests/bank-reconciliation-integration.test.ts",
  "tests/budget-money-integration.test.ts",
  "tests/budget-reports-integration.test.ts", // K-CASH-7 changes/restores Books opening and BudgetState singleton on disposable DB.
  "tests/budget-planning-integration.test.ts", // K-CASH-5A changes/restores shared BusinessSettings planning horizon.
  "tests/budget-schema-integration.test.ts", // K-CASH-3 temporarily changes/restores singleton Books start; it must be serial.
  "tests/books-cash-events-integration.test.ts", // K-CASH-2 fixture changes global Books opening date and restores it.
  "tests/books-closing-integration.test.ts", // K-8 toggles Books start during isolated real-database source tests.
  "tests/books-reports-integration.test.ts", // K-7 read-only reports fixture temporarily seeds an isolated Books opening date.
  "tests/books-depreciation-integration.test.ts", // K-6 adjusts verified opening date and book life defaults in a serial database fixture.
  "tests/books-export-delivery-integration.test.ts", // K-CASH-6 also updates/restores singleton Books opening.
  "tests/books-exports-integration.test.ts", // K-5 temporarily sets shared Books opening date and verifies export provenance.
  "tests/books-expenses-integration.test.ts", // K-4 modifies the verified business tax context, restores it after the serial DB suite.
  "tests/books-stripe-sync-integration.test.ts", // K-3 fixture temporarily changes the shared books start and Stripe import cursor.
  "tests/site-content-integration.test.ts", // The website pointer and every revision exist once for the whole database.
  "tests/vc1-vc2-content-integration.test.ts", // V-C1/V-C2 publish, restore and clean the same single website pointer.
  "tests/vc3-public-content-integration.test.ts", // V-C3 publishes and cleans the same single website pointer.
  "tests/vc4-website-editor-integration.test.ts", // V-C4 publishes, restores and cleans the same single website pointer.
  "tests/location-contacts-integration.test.ts", // W-23 retention policy is global and restored after testing.
  "tests/w22-v2-flow-integration.test.ts",
  "tests/purchases-w14-w2-w15-integration.test.ts", // Purchase tax answers use the shared tax settings and filing calendar.
  "tests/rental-turning-points-w4-integration.test.ts", // Changes and restores the shared rental-ending reminder setting.
  "tests/w5-w6-integration.test.ts", // Changes and restores the shared lead response time and payment-link wording settings.
  "tests/setup-checklist-integration.test.ts", // W-7 blanks and restores shared settings, prices, filing accounts and the business address.
  "tests/w9-filing-autopilot-integration.test.ts", // W-9 creates Colorado filing accounts and periods that the whole-database filing list and health check read.
  "tests/w19-flow-gaps-integration.test.ts", // W-19 changes and restores the shared unsigned-agreement reminder setting.
  // Tax-ready fixtures also write/restore BusinessSettings.singleton through their helper.
  "tests/billing-webhooks.test.ts",
  "tests/pickup-billing-end-integration.test.ts",
  "tests/signing-manual-payment-w22-integration.test.ts",
  "tests/signing-dispatch-integration-w22fin.test.ts",
  "tests/signing-send-guard-w22-integration.test.ts",
  "tests/tax-address-recheck-integration.test.ts",
  "tests/tax-exemptions-integration.test.ts",
  "tests/tax-prepaid-invoice-integration.test.ts",
  "tests/tax-rate-change-integration.test.ts",
  "tests/tax-refund-evidence-integration.test.ts",
  "tests/tax-stripe-invoice-mirror-integration.test.ts",
  "tests/agreements-term-integration.test.ts",
  "tests/settings-integration.test.ts",
  "tests/signing-charge-settings-integration.test.ts",
  "tests/signing-mandatory-policy-integration-w22fin.test.ts",
  "tests/estimate-preapproval-prepare-integration-w22fin.test.ts",
  // Mutates/restores BusinessSettings singleton while verifying mandatory charges.
  "tests/commercial-reserve-integration-w22fin.test.ts",
  "tests/sms-activation-integration.test.ts",
  "tests/communication-launch-integration.test.ts", // reads seeded singleton; keep alongside serialized settings writers
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
  "tests/shop-sale-integration.test.ts", // M-1C replaces the shop tax address and rates, then restores them.
  "tests/retired-appliance-plan-integration.test.ts",
  "tests/scrap-payment-integration.test.ts",
  "tests/resale-stock-integration.test.ts", // M-1B replaces the business tax address and rates for its use-tax example, then restores them.
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
  "tests/voice-voicemail-integration.test.ts",
  "tests/use-tax-frequency-transition-integration.test.ts",
  "tests/use-tax-unlinked-account-integration.test.ts",
  // Added 2026-10-17 (F2-A/F2-B): the integrated scenarios seed the shared tax settings, switch shared business settings
  // on and off, and work through whole-database queues (billing hand-offs, waiting notices, due terminations), so they
  // run one after another and never beside each other.
  "tests/scenarios/**/*.test.ts",
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
      "server-only": path.resolve(import.meta.dirname, "./tests/server-only-marker.ts"),
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
