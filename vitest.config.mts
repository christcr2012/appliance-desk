import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const SHARED_SETTINGS_TESTS = [
  "tests/mcp-decisions-apply-integration.test.ts", // MCP-5 briefly applies and restores shared DEC-1 business settings.
  "tests/books-poster-integration.test.ts", // K-2A changes/restores the books start date; no parallel writes to singleton.
  "tests/ops8-continuity-integration.test.ts", // OPS-8 changes and restores the shared continuity details and the charges-paused switch.
  "tests/ops3-vehicle-integration.test.ts", // OPS-3 changes and restores the shared mileage method and medical-card setting.
  "tests/ops4-insurance-integration.test.ts", // OPS-4 changes and restores the shared insurance reminder days and workers' compensation status.
  "tests/ops2-refrigerant-integration.test.ts", // OPS-2 briefly changes and restores which record kinds admins may see (the shared vault setting).
  "tests/ops3-mileage-schedule-c-integration.test.ts", // OPS-3 changes and restores the shared mileage method.
  "tests/ops7-privacy-integration.test.ts", // OPS-7 changes and restores the shared privacy settings (retention years, purge switch).
  "tests/job-click-to-call-integration.test.ts", // COM-N2 changes and restores the shared phone policy.
  "tests/telecom-reporting-settings-integration.test.ts", // COM-N4 changes and restores the shared phone policy.
  "tests/com-n1c-workflow-integration.test.ts", // COM-N1C changes and restores the shared phone/text policy, text switch and approved wording.
  "tests/com-n1b-workflow-integration.test.ts", // COM-N1B changes and restores the shared phone/text policy, text switch and approved wording.
  "tests/telecom-alert-check-integration.test.ts", // changes and restores the shared phone/alert policy.
  "tests/communications-foundation-integration.test.ts", // reads the shared text master switch, which the COM-N1 tests turn on for a few seconds.
  "tests/com-n1a-workflow-integration.test.ts", // COM-N1A changes and restores the shared phone/text policy, text switch and approved wording.
  "tests/acc2-team-invitations-integration.test.ts", // ACC-2 changes and restores the shared invitation settings.
  "tests/accountant-access-integration.test.ts", // ACCT-1 stamps and restores the shared accountant-changes seen marker and the books start date.
  "tests/acc3-second-step-integration.test.ts", // ACC-3 changes and restores the shared sign-in method rules and text-code switch.
  "tests/acc4-recovery-integration.test.ts", // ACC-4 changes and restores the shared wrong-password pause numbers and invitation link days.
  "tests/acc5-job-roles-integration.test.ts", // ACC-5 edits the shared starting job roles and the invitation settings.
  "tests/trusted-devices-integration.test.ts", // ACC-6 changes and restores the remember-days setting, the customer-email switch and the text-code switch.
  "tests/business-records-integration.test.ts", // VAULT-1 changes and restores the shared admin-visible record kinds setting.
  "tests/setup-guide-integration.test.ts", // SETUP-1 creates a Colorado filing account and reads guide state across all records.
  "tests/vault-integration.test.ts", // VAULT-2 changes and restores the shared emergency-access settings on the singleton row.
  "tests/taxben-classification.test.ts", // TAXBEN-1 writes the shared business-settings singleton inside a rolled-back transaction.
  "tests/taxben-benefits-integration.test.ts", // TAXBEN-1 writes the shared settings and compliance-profile singletons inside a rolled-back transaction.
  "tests/taxben-elections.test.ts", // TAXBEN-2 changes and restores the shared de minimis elections map on the settings singleton.
  "tests/goals-integration.test.ts", // O-5 changes and restores the shared alert settings.
  "tests/approvals-integration.test.ts", // O-3 changes and restores the shared approval limits and settings row.
  "tests/approval-money-integration.test.ts", // O-3B changes and restores the shared approval limits.
  "tests/used-appliance-sale-integration.test.ts", // M-2C sets and restores the shared books start date.
  "tests/shop-sale-delivery-fee-integration.test.ts", // M-1C sets and restores the shared delivery-fee settings and creates a Colorado filing account.
  "tests/capabilities-integration.test.ts", // O-2A limits an admin and restores it; reads/writes the shared override table and settings row.
  "tests/features-integration.test.ts", // AR-12 owner-only visibility saves mutate and restore the shared BusinessSettings singleton.
  "tests/stored-file-cleanup-integration.test.ts", // Older findings: changes and restores the shared file-keeping days settings.
  "tests/scheduled-prices-integration.test.ts", // O-4 the nightly job applies every due change in the database; it must not overlap the set-price suite.
  "tests/scheduled-package-prices-integration.test.ts", // O-4 same nightly job as above, for rental sets.
  "tests/starting-values-integration.test.ts", // DEC-2 archives other owners and looks at every question; must not overlap other tests.
  "tests/decisions-integration.test.ts", // DEC-1a changes/restores shared tax settings and an all-state default tax rule; runs the same nightly job.
  "tests/settings-undo-integration.test.ts", // O-1 changes and restores shared BusinessSettings fields and reads the settings audit history.
  "tests/estimate-zone-integration.test.ts", // ZONE-1 changes and restores the shared delivery zones.
  "tests/bank-reconciliation-integration.test.ts",
  "tests/budget-money-integration.test.ts",
  "tests/budget-reports-integration.test.ts", // K-CASH-7 changes/restores Books opening and BudgetState singleton on disposable DB.
  "tests/budget-planning-integration.test.ts", // K-CASH-5A changes/restores shared BusinessSettings planning horizon.
  "tests/budget-schema-integration.test.ts", // K-CASH-3 temporarily changes/restores singleton Books start; it must be serial.
  "tests/books-cash-events-integration.test.ts", // K-CASH-2 fixture changes global Books opening date and restores it.
  "tests/books-closing-integration.test.ts", // K-8 toggles Books start during isolated real-database source tests.
  "tests/books-reports-integration.test.ts", // K-7 read-only reports fixture temporarily seeds an isolated Books opening date.
  "tests/books-cash-adjustments-integration.test.ts", // ACCT-1 cash-basis adjustments fixture temporarily seeds an isolated Books opening date.
  "tests/tax-filing-packet-accountant-integration.test.ts", // ACCT-1 live filing packet fixture creates its own filing account and period.
  "tests/books-depreciation-integration.test.ts", // K-6 adjusts verified opening date and book life defaults in a serial database fixture.
  "tests/ba1-books-autopilot-integration.test.ts", // BA-1 modifies singleton Books dates and depreciation.
  "tests/ba1-nightly-autopilot-integration.test.ts", // BA-1 changes the singleton Books start and health settings.
  "tests/ba2-books-setup-integration.test.ts", // BA-2 owns the Books singleton and closes/reopens historical periods.
  "tests/ba3-month-review-integration.test.ts", // BA-3 opens/locks periods and owns Books singleton.
  "tests/books-export-delivery-integration.test.ts", // K-CASH-6 also updates/restores singleton Books opening.
  "tests/books-exports-integration.test.ts", // K-5 temporarily sets shared Books opening date and verifies export provenance.
  "tests/telecom-statement-books-integration.test.ts", // COM-N3 changes booksStartDate and posts expenses.
  "tests/books-expenses-integration.test.ts", // K-4 modifies the verified business tax context, restores it after the serial DB suite.
  "tests/books-stripe-sync-integration.test.ts", // K-3 fixture temporarily changes the shared books start and Stripe import cursor.
  "tests/site-content-integration.test.ts", // The website pointer and every revision exist once for the whole database.
  "tests/vc1-vc2-content-integration.test.ts", // V-C1/V-C2 publish, restore and clean the same single website pointer.
  "tests/vc3-public-content-integration.test.ts", // V-C3 publishes and cleans the same single website pointer.
  "tests/vc4-website-editor-integration.test.ts", // V-C4 publishes, restores and cleans the same single website pointer.
  "tests/location-contacts-integration.test.ts", // W-23 retention policy is global and restored after testing.
  "tests/w22-v2-flow-integration.test.ts",
  "tests/zone-route-exception-integration.test.ts", // ZONE-1 sets and restores the shared driving origin and fee policy.
  "tests/zone-pickup-handoff-integration.test.ts", // ZONE-1 seeds a tax-ready address (changes and restores shared tax settings).
  "tests/purchases-w14-w2-w15-integration.test.ts", // Purchase tax answers use the shared tax settings and filing calendar.
  "tests/rental-turning-points-w4-integration.test.ts", // Changes and restores the shared rental-ending reminder setting.
  "tests/w5-w6-integration.test.ts", // Changes and restores the shared lead response time and payment-link wording settings.
  "tests/lead-assignment-integration.test.ts", // LD-1 changes and restores the shared lead-assignment settings (mode, person, rotation cursor).
  "tests/setup-checklist-integration.test.ts", // W-7 blanks and restores shared settings, prices, filing accounts and the business address.
  "tests/w9-filing-autopilot-integration.test.ts", // W-9 creates Colorado filing accounts and periods that the whole-database filing list and health check read.
  "tests/w19-flow-gaps-integration.test.ts", // W-19 changes and restores the shared unsigned-agreement reminder setting.
  // Tax-ready fixtures also write/restore BusinessSettings.singleton through their helper.
  "tests/bank-in-flight-nightly.test.ts", // BILL-1: the nightly check looks at every open bank-payment flag in the database, so it must not overlap the webhook suite that creates them.
  "tests/bank-in-flight-webhook-integration.test.ts", // BILL-1: same shared flag rows as the nightly suite above.
  "tests/billing-webhooks.test.ts",
  "tests/pickup-billing-end-integration.test.ts",
  "tests/signing-manual-payment-w22-integration.test.ts",
  "tests/signing-dispatch-integration-w22fin.test.ts",
  "tests/signing-send-guard-w22-integration.test.ts",
  "tests/tax-address-recheck-integration.test.ts",
  "tests/tax-exemptions-integration.test.ts",
  "tests/tax-prepaid-invoice-integration.test.ts",
  "tests/tax-rate-change-integration.test.ts",
  "tests/rules-as-of-integration.test.ts", // TFA-1 changes and restores the shared timing settings; its rule versions are test-scoped.
  "tests/rules-observation-integration.test.ts", // TFA-3 approves and dismisses rule readings; its versions are test-scoped and removed after.
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
  "tests/automation-health-integration.test.ts", // MCP-1 changes and restores the shared "late" grace setting.
  "tests/batch-b2-migration-integration.test.ts",
  "tests/business-tax-address-confirm-integration.test.ts",
  "tests/communications-intent-integration.test.ts",
  "tests/job-scheduling-integration.test.ts",
  "tests/job-scope-integration.test.ts",
  "tests/purchase-tax-recalculate-integration.test.ts",
  "tests/rdf-filing-integration.test.ts",
  "tests/rdf-threshold-integration.test.ts",
  "tests/rdf-autopilot-integration.test.ts", // TFA-2 changes and restores the shared crossing date on the settings row.
  "tests/retail-delivery-fee-integration.test.ts",
  "tests/subscription-end-integration.test.ts",
  "tests/system-issue-sweep-integration.test.ts",
  "tests/tax-filing-finalization-integration.test.ts",
  "tests/tax-filing-integration.test.ts",
  "tests/tax-filing-reminders-integration.test.ts",
  "tests/tax-invoice-lines-integration.test.ts",
  "tests/order-service-choice-integration.test.ts", // FEETAX-1: seedTaxReadyContext flips the shared lease-election setting while it runs.
  "tests/tax-official-rate-auto-apply-integration.test.ts",
  "tests/tax-official-source-watch-integration.test.ts", // TFA-3 toggles the shared watch switch and the seeded watches' active flags while it runs.
  "tests/tax-official-rate-metadata-integration.test.ts", // Asserts on the seeded watches' active flags and the settings singleton the watch suites toggle.
  "tests/tax-overview.test.ts",
  "tests/tax-return-actions-integration.test.ts",
  "tests/tax-setup-actions-integration.test.ts",
  "tests/tax-setup-review-integration.test.ts",
  "tests/two-factor-enforcement-integration.test.ts",
  "tests/voice-webhooks-integration.test.ts",
  "tests/voice-voicemail-integration.test.ts",
  "tests/use-tax-frequency-transition-integration.test.ts",
  "tests/use-tax-year-reset.test.ts", // TFA-2 creates Colorado use-tax filing accounts and periods.
  "tests/license-renewal.test.ts", // TFA-2 creates and edits shared filing accounts.
  "tests/filing-frequency-advice.test.ts", // TFA-2 creates filing accounts, periods and advice.
  "tests/exemption-expiry-flow-integration.test.ts", // TFA-2 creates customers, certificates and credits.
  "tests/use-tax-unlinked-account-integration.test.ts",
  // Added 2026-10-17 (F2-A/F2-B): the integrated scenarios seed the shared tax settings, switch shared business settings
  // on and off, and work through whole-database queues (billing hand-offs, waiting notices, due terminations), so they
  // run one after another and never beside each other.
  "tests/scenarios/**/*.test.ts",
  "tests/payroll-import-integration.test.ts", // CMP-5 sets and restores the shared Books start date and the compliance facts (employees, first hire date).
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
