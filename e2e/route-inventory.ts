export type AccessibilityRouteRole = "PUBLIC" | "OWNER" | "CUSTOMER" | "STAFF";

export type AccessibilityRoute = {
  /** Route template exactly as it exists under src/app. */
  path: string;
  role: AccessibilityRouteRole;
  /**
   * For automated routes this is the exact URL CI should visit.
   * For manual-only routes this names the fixture a human must prepare.
   */
  fixture: string;
  manualOnlyReason?: string;
};

export const ACCESSIBILITY_ROUTES: AccessibilityRoute[] = [
  {
    path: "/connect/consent", role: "OWNER",
    fixture: "A registered SDK OAuth client with a valid pending authorization code and active owner login",
    manualOnlyReason: "A live client approval request and a time-limited OAuth authorization code are required.",
  },
  { path: "/", role: "PUBLIC", fixture: "/" },
  { path: "/accessibility", role: "PUBLIC", fixture: "/accessibility" },
  { path: "/contact", role: "PUBLIC", fixture: "/contact" },
  { path: "/how-it-works", role: "PUBLIC", fixture: "/how-it-works" },
  { path: "/launch", role: "PUBLIC", fixture: "/launch" },
  { path: "/offline", role: "PUBLIC", fixture: "/offline" },
  { path: "/pricing", role: "PUBLIC", fixture: "/pricing" },
  { path: "/privacy", role: "PUBLIC", fixture: "/privacy" },
  { path: "/privacy/how-we-handle-your-information", role: "PUBLIC", fixture: "/privacy/how-we-handle-your-information" },
  { path: "/rent/[city]", role: "PUBLIC", fixture: "/rent/denver" },
  { path: "/service-area", role: "PUBLIC", fixture: "/service-area" },
  { path: "/terms", role: "PUBLIC", fixture: "/terms" },
  {
    path: "/tenant/repair/[token]",
    role: "PUBLIC",
    fixture: "An individually created time-limited one-use link for a permitted current occupant",
    manualOnlyReason: "The token is short-lived and one-use, requiring a controlled tenant and assigned-appliance fixture.",
  },
  {
    path: "/estimate/[id]",
    role: "PUBLIC",
    fixture: "A real public estimate link in an isolated test database",
    manualOnlyReason:
      "The public estimate page requires a generated estimate id with a valid customer-visible state; CI does not create a stable public estimate id.",
  },
  { path: "/forgot-password", role: "PUBLIC", fixture: "/forgot-password" },
  {
    path: "/launch/confirm/[token]",
    role: "PUBLIC",
    fixture: "A newly issued launch confirmation token",
    manualOnlyReason:
      "Launch confirmation tokens are single-use and expire; a fixed token would make the accessibility test stateful and non-repeatable.",
  },
  { path: "/join/[code]", role: "PUBLIC", fixture: "/join/not-a-real-link" },
  {
    path: "/w9/[token]",
    role: "PUBLIC",
    fixture: "A newly issued one-time W-9 request link for a test supplier",
    manualOnlyReason:
      "W-9 links are single-use and expire in 14 days; a fixed token would make the accessibility test stateful and non-repeatable.",
  },
  { path: "/login", role: "PUBLIC", fixture: "/login" },
  { path: "/login/two-factor", role: "PUBLIC", fixture: "/login/two-factor" },
  { path: "/reset-password", role: "PUBLIC", fixture: "/reset-password" },
  { path: "/scan/[assetNumber]", role: "STAFF", fixture: "/scan/CI-SECURITY-UNIT" },
  {
    path: "/sign/[id]",
    role: "PUBLIC",
    fixture: "A real unsigned agreement signing link in an isolated test database",
    manualOnlyReason:
      "The signing page requires a generated agreement in a signable state; a fixed agreement id would mutate and expire across runs.",
  },

  { path: "/account", role: "CUSTOMER", fixture: "/account" },
  { path: "/account/billing", role: "CUSTOMER", fixture: "/account/billing" },
  {
    path: "/account/billing/invoice/[invoiceId]",
    role: "CUSTOMER",
    fixture: "The CI customer's generated paid invoice",
    manualOnlyReason:
      "The customer seed creates the invoice with a generated id; its authorization behavior is covered separately by customer-isolation tests.",
  },
  { path: "/account/maintenance", role: "CUSTOMER", fixture: "/account/maintenance" },
  { path: "/account/properties", role: "CUSTOMER", fixture: "/account/properties" },
  { path: "/account/rentals", role: "CUSTOMER", fixture: "/account/rentals" },
  { path: "/account/settings", role: "CUSTOMER", fixture: "/account/settings" },
  { path: "/account/settings/privacy", role: "CUSTOMER", fixture: "/account/settings/privacy" },
  // MCP-10a app feedback (people only).
  { path: "/account/feedback", role: "CUSTOMER", fixture: "/account/feedback" },
  { path: "/account/feedback/new", role: "CUSTOMER", fixture: "/account/feedback/new?from=/account/rentals" },
  {
    path: "/account/feedback/[id]",
    role: "CUSTOMER",
    fixture: "A report the CI customer sent (created by e2e/feedback.spec.ts)",
    manualOnlyReason: "The report id is generated when the browser test sends it; e2e/feedback.spec.ts opens this page with axe on phone and desktop.",
  },

  { path: "/desk/communications", role: "OWNER", fixture: "/desk/communications" },
  { path: "/desk/communications/calls", role: "OWNER", fixture: "/desk/communications/calls" },
  {
    path: "/desk/communications/calls/[id]", role: "OWNER",
    fixture: "A signed Twilio voicemail or missed call in an isolated database",
    manualOnlyReason:
      "The private call id is generated by provider ingestion; dedicated database/authorization cases create this state.",
  },
  {
    path: "/desk/communications/[id]", role: "OWNER",
    fixture: "A private communication thread in an isolated database",
    manualOnlyReason: "Each thread contains private message content and requires a created signed-provider fixture.",
  },
  { path: "/desk/activity", role: "OWNER", fixture: "/desk/activity" },
  {
    path: "/desk/agreements/[id]/cancel", role: "OWNER",
    fixture: "An undelivered rental agreement in isolated CI storage",
    manualOnlyReason: "Requires a per-test agreement id and active authenticated owner; the dedicated Playwright spec covers the review and accessibility.",
  },
  {
    path: "/desk/agreements/[id]/early-return",
    role: "OWNER",
    fixture: "A generated fixed-term active agreement eligible for early return",
    manualOnlyReason:
      "Eligibility depends on agreement terms and dates; the CI seed does not expose a deterministic agreement id/state for this page.",
  },
  {
    path: "/desk/agreements/[id]",
    role: "OWNER",
    fixture: "A generated rental agreement in the isolated CI database",
    manualOnlyReason:
      "The seeded agreement id is generated per run; agreement presentation and behavior have dedicated browser/integration coverage.",
  },
  { path: "/desk/agreements/[id]/ending-decision", role: "OWNER", fixture: "Active fixed-term agreement ending within the notice window in a disposable database", manualOnlyReason: "Needs an active fixed-term agreement; the W-4 database test supplies it and the page redirects to a draft on each choice." },
  { path: "/desk/agreements/[id]/refund", role: "OWNER", fixture: "Approved cancellation in a disposable database", manualOnlyReason: "An owner-only verified refund liability is required; dedicated DB/browser tests supply this fixture." },
  { path: "/desk/agreements/new", role: "OWNER", fixture: "/desk/agreements/new" },
  { path: "/desk/agreements", role: "OWNER", fixture: "/desk/agreements" },
  { path: "/desk/automations", role: "OWNER", fixture: "/desk/automations" },
  {
    path: "/desk/billing/customer/[id]/invoice/[invoiceId]",
    role: "OWNER",
    fixture: "A generated customer and invoice pair in the isolated CI database",
    manualOnlyReason:
      "Both ids are generated by the CI customer fixture; financial isolation is covered by dedicated billing/customer-isolation tests.",
  },
  {
    path: "/desk/billing/customer/[id]",
    role: "OWNER",
    fixture: "A generated customer id in the isolated CI database",
    manualOnlyReason:
      "The customer fixture id is generated per run; the customer billing workspace has dedicated browser coverage.",
  },
  {
    path: "/desk/billing/deposits/[id]",
    role: "OWNER",
    fixture: "A generated deposit-liability row",
    manualOnlyReason:
      "This page requires a specific deposit-liability record that is not seeded with a deterministic id.",
  },
  { path: "/desk/billing/held-payments", role: "OWNER", fixture: "/desk/billing/held-payments" },
  { path: "/desk/billing", role: "OWNER", fixture: "/desk/billing" },
  { path: "/desk/billing/reconciliation", role: "OWNER", fixture: "/desk/billing/reconciliation" },
  { path: "/desk/compliance", role: "OWNER", fixture: "/desk/compliance" },
  { path: "/desk/compliance/facts", role: "OWNER", fixture: "/desk/compliance/facts" },
  {
    path: "/desk/compliance/[id]",
    role: "OWNER",
    fixture: "A generated compliance filing id",
    manualOnlyReason:
      "The CI seed does not create a deterministic filing id; filing behavior is covered by the compliance workflow tests.",
  },
  {
    path: "/desk/customers/[id]",
    role: "OWNER",
    fixture: "A generated customer id in the isolated CI database",
    manualOnlyReason:
      "The CI customer id is generated per run; customer workspace behavior is covered by dedicated browser tests.",
  },
  {
    path: "/desk/customers/[id]/locations",
    role: "OWNER",
    fixture: "A customer with created location contacts in disposable CI storage",
    manualOnlyReason: "The client identifier changes per run; e2e/location-contacts.spec.ts exercises an authenticated owner/customer fixture.",
  },
  { path: "/desk/customers/new", role: "OWNER", fixture: "/desk/customers/new" },
  { path: "/desk/customers", role: "OWNER", fixture: "/desk/customers" },
  { path: "/desk/dashboard", role: "OWNER", fixture: "/desk/dashboard" },
  { path: "/desk/dispatch", role: "OWNER", fixture: "/desk/dispatch" },
  { path: "/desk/more", role: "OWNER", fixture: "/desk/more" },
  { path: "/desk/account", role: "OWNER", fixture: "/desk/account" },
  { path: "/desk/driver", role: "STAFF", fixture: "/desk/driver" },
  {
    path: "/desk/estimates/[id]",
    role: "OWNER",
    fixture: "A generated estimate id",
    manualOnlyReason:
      "The estimate detail route requires a generated record and has dedicated estimate browser/integration coverage.",
  },
  { path: "/desk/estimates/new", role: "OWNER", fixture: "/desk/estimates/new" },
  { path: "/desk/estimates", role: "OWNER", fixture: "/desk/estimates" },
  { path: "/desk/phone-orders", role: "OWNER", fixture: "/desk/phone-orders" },
  { path: "/desk/phone-orders/new", role: "OWNER", fixture: "/desk/phone-orders/new" },
  { path: "/desk/fleet", role: "OWNER", fixture: "/desk/fleet" },
  { path: "/desk/growth", role: "OWNER", fixture: "/desk/growth" },
  { path: "/desk/inventory/[id]", role: "OWNER", fixture: "/desk/inventory/ci-security-appliance" },
  { path: "/desk/inventory/[id]/qr", role: "OWNER", fixture: "/desk/inventory/ci-security-appliance/qr" },
  {
    path: "/desk/inventory/[id]/out-of-service",
    role: "OWNER",
    fixture: "An appliance with an open out-of-service (taken for repair) period",
    manualOnlyReason: "CI seeds no open repair period; the flow is covered by tests/out-of-service-integration.test.ts.",
  },
  {
    path: "/desk/inventory/[id]/split",
    role: "OWNER",
    fixture: "An appliance still recorded under the retired Washer + Dryer Set type",
    manualOnlyReason: "CI seeds no old one-record set; the split itself is covered by tests/rental-package-lines-integration.test.ts.",
  },
  { path: "/desk/inventory", role: "OWNER", fixture: "/desk/inventory" },
  { path: "/desk/disputes", role: "OWNER", fixture: "/desk/disputes" },
  { path: "/desk/collections", role: "OWNER", fixture: "/desk/collections" },
  { path: "/desk/continuity", role: "OWNER", fixture: "/desk/continuity" },
  { path: "/desk/continuity/checkup", role: "OWNER", fixture: "/desk/continuity/checkup" },
  {
    path: "/desk/collections/[agreementId]",
    role: "OWNER",
    fixture: "A rental that is far behind on a bill",
    manualOnlyReason: "CI seeds no overdue rental past the day-30 decision; the flow is covered by tests/ops6-collections-integration.test.ts.",
  },
  {
    path: "/desk/disputes/[id]",
    role: "OWNER",
    fixture: "A payment dispute opened by Stripe",
    manualOnlyReason: "CI seeds no dispute; the flow is covered by tests/ops5-disputes-integration.test.ts.",
  },
  { path: "/desk/recalls", role: "OWNER", fixture: "/desk/recalls" },
  {
    path: "/desk/recalls/[recallId]",
    role: "OWNER",
    fixture: "A possible recall match found by the nightly check",
    manualOnlyReason: "CI cannot reach the government recall list, so no match exists; the flow is covered by tests/ops1-recalls-integration.test.ts.",
  },
  {
    path: "/desk/recalls/incidents/[id]",
    role: "OWNER",
    fixture: "A safety incident someone marked from a repair request or job",
    manualOnlyReason: "CI seeds no safety incident; the flow is covered by tests/ops1-recalls-integration.test.ts.",
  },
  { path: "/desk/inventory/retired", role: "OWNER", fixture: "/desk/inventory/retired" },
  { path: "/desk/jobs/[id]", role: "OWNER", fixture: "/desk/jobs/ci-security-job" },
  { path: "/desk/jobs/[id]/work-order", role: "OWNER", fixture: "/desk/jobs/ci-security-job/work-order" },
  { path: "/desk/jobs/new", role: "OWNER", fixture: "/desk/jobs/new" },
  { path: "/desk/jobs", role: "OWNER", fixture: "/desk/jobs" },
  { path: "/desk/launch", role: "OWNER", fixture: "/desk/launch" },
  {
    path: "/desk/leads/[id]",
    role: "OWNER",
    fixture: "A generated lead id",
    manualOnlyReason:
      "The CI seed does not create a deterministic lead id; lead detail behavior is covered by lead workflow tests.",
  },
  { path: "/desk/leads/new", role: "OWNER", fixture: "/desk/leads/new" },
  { path: "/desk/leads", role: "OWNER", fixture: "/desk/leads" },
  {
    path: "/desk/maintenance/[id]",
    role: "OWNER",
    fixture: "A generated maintenance request id",
    manualOnlyReason:
      "The CI seed does not create a deterministic maintenance-request id; request detail behavior has dedicated tests.",
  },
  { path: "/desk/maintenance", role: "OWNER", fixture: "/desk/maintenance" },
  {
    path: "/desk/notices/[id]/resolve",
    role: "OWNER",
    fixture: "A generated unresolved customer notice",
    manualOnlyReason:
      "The page requires a live unresolved notice whose state changes when resolved; fixed reusable fixture data would be unsafe.",
  },
  { path: "/desk/notices", role: "OWNER", fixture: "/desk/notices" },
  {
    path: "/desk/parts/[id]",
    role: "OWNER",
    fixture: "A generated part id",
    manualOnlyReason:
      "The CI seed does not create a deterministic part record; inventory-part behavior is covered by real-Postgres tests.",
  },
  { path: "/desk/paperwork", role: "OWNER", fixture: "/desk/paperwork" },
  { path: "/desk/setup-guide", role: "OWNER", fixture: "/desk/setup-guide" },
  { path: "/desk/setup-guide/[key]", role: "OWNER", fixture: "/desk/setup-guide/ein" },
  { path: "/desk/vault", role: "OWNER", fixture: "/desk/vault" },
  {
    path: "/desk/vault/[id]",
    role: "OWNER",
    fixture: "A generated vault credential id",
    manualOnlyReason:
      "Vault logins are created by the owner; the CI seed has none. Item behavior is covered by real-Postgres tests.",
  },
  {
    path: "/emergency/[token]",
    role: "PUBLIC",
    fixture: "A generated emergency link token",
    manualOnlyReason:
      "Emergency links are issued by the owner on demand and ship switched off; the public page behavior is covered by real-Postgres tests.",
  },
  { path: "/desk/vehicle", role: "OWNER", fixture: "/desk/vehicle" },
  { path: "/desk/insurance", role: "OWNER", fixture: "/desk/insurance" },
  {
    path: "/desk/paperwork/[id]",
    role: "OWNER",
    fixture: "A generated paperwork item id",
    manualOnlyReason:
      "Paperwork items are created by the owner from the starter checklist; the CI seed has none. Item behavior is covered by real-Postgres tests.",
  },
  { path: "/desk/paperwork/new", role: "OWNER", fixture: "/desk/paperwork/new" },
  { path: "/desk/parts", role: "OWNER", fixture: "/desk/parts" },
  { path: "/desk/privacy", role: "OWNER", fixture: "/desk/privacy" },
  { path: "/desk/privacy-security", role: "OWNER", fixture: "/desk/privacy-security" },
  { path: "/desk/sales", role: "OWNER", fixture: "/desk/sales" },
  { path: "/desk/sales/new", role: "OWNER", fixture: "/desk/sales/new" },
  {
    path: "/desk/sales/[id]",
    role: "OWNER",
    fixture: "A generated shop-sale invoice id",
    manualOnlyReason:
      "A sale needs completed tax setup and a sellable part, which the CI seed does not create; sale behavior is covered by real-Postgres tests.",
  },
  {
    path: "/desk/purchase-orders/[id]",
    role: "OWNER",
    fixture: "A generated purchase order id",
    manualOnlyReason:
      "Purchase-order detail requires a generated order and mutable lifecycle state; dedicated purchasing browser tests cover it.",
  },
  {
    path: "/desk/purchases/[id]",
    role: "OWNER",
    fixture: "A generated purchase id",
    manualOnlyReason:
      "Purchase detail needs a recorded purchase; real-Postgres purchase tests and the record-a-purchase browser test cover it.",
  },
  { path: "/desk/purchases/new", role: "OWNER", fixture: "/desk/purchases/new" },
  { path: "/desk/purchases", role: "OWNER", fixture: "/desk/purchases" },
  { path: "/desk/purchase-orders/new", role: "OWNER", fixture: "/desk/purchase-orders/new" },
  { path: "/desk/purchase-orders", role: "OWNER", fixture: "/desk/purchase-orders" },
  { path: "/desk/reports", role: "OWNER", fixture: "/desk/reports" },
  { path: "/desk/revenue", role: "OWNER", fixture: "/desk/revenue" },
  { path: "/desk/books", role: "OWNER", fixture: "/desk/books" },
  { path: "/desk/books/cash", role: "OWNER", fixture: "/desk/books/cash" },
  { path: "/desk/books/cash/checks", role: "OWNER", fixture: "/desk/books/cash/checks" },
  { path: "/desk/books/budget", role: "OWNER", fixture: "/desk/books/budget" },
  { path: "/desk/books/budget/review/[id]", role: "OWNER",
    fixture: "An immutable saved month-end report snapshot id in isolated Postgres",
    manualOnlyReason: "Requires an owner-published historical evidence row with a generated private identifier; dedicated owner report and source-role tests exercise archive reading.",
  },
  { path: "/desk/books/closing", role: "OWNER", fixture: "/desk/books/closing" },
  { path: "/desk/books/assets", role: "OWNER", fixture: "/desk/books/assets" },
  { path: "/desk/books/reports", role: "OWNER", fixture: "/desk/books/reports" },
  { path: "/desk/books/setup", role: "OWNER", fixture: "/desk/books/setup" },
  { path: "/desk/books/months/[month]", role: "OWNER", fixture: "/desk/books/months/2026-09" },
  { path: "/desk/books/exports", role: "OWNER", fixture: "/desk/books/exports" },
  { path: "/desk/expenses", role: "STAFF", fixture: "/desk/expenses" },
  { path: "/desk/search", role: "OWNER", fixture: "/desk/search?q=washer" },
  { path: "/desk/security/setup", role: "OWNER", fixture: "/desk/security/setup" },
  { path: "/desk/settings", role: "OWNER", fixture: "/desk/settings" },
  { path: "/desk/settings/rental-endings", role: "OWNER", fixture: "/desk/settings/rental-endings" },
  { path: "/desk/settings/payment-links", role: "OWNER", fixture: "/desk/settings/payment-links" },
  { path: "/desk/settings/lead-response", role: "OWNER", fixture: "/desk/settings/lead-response" },
  // MCP-10a app feedback: settings, triage (owner/admin), and every team member's own reports.
  { path: "/desk/settings/feedback", role: "OWNER", fixture: "/desk/settings/feedback" },
  { path: "/desk/settings/decisions", role: "OWNER", fixture: "/desk/settings/decisions" },
  { path: "/desk/settings/decisions/import", role: "OWNER", fixture: "/desk/settings/decisions/import" },
  { path: "/desk/feedback", role: "OWNER", fixture: "/desk/feedback" },
  { path: "/desk/feedback/new", role: "STAFF", fixture: "/desk/feedback/new?from=/desk/today" },
  { path: "/desk/feedback/mine", role: "STAFF", fixture: "/desk/feedback/mine" },
  {
    path: "/desk/feedback/[id]",
    role: "OWNER",
    fixture: "A report sent by the CI customer (created by e2e/feedback.spec.ts)",
    manualOnlyReason: "The report id is generated when the browser test sends it; e2e/feedback.spec.ts opens this page with axe on phone and desktop.",
  },
  {
    path: "/desk/feedback/mine/[id]",
    role: "STAFF",
    fixture: "A report sent by a team member",
    manualOnlyReason: "Uses the same MyReportView as /account/feedback/[id], which e2e/feedback.spec.ts scans; the id is generated per run.",
  },
  { path: "/desk/settings/history", role: "OWNER", fixture: "/desk/settings/history" },
  { path: "/desk/settings/features", role: "OWNER", fixture: "/desk/settings/features" },
  { path: "/desk/settings/switches", role: "OWNER", fixture: "/desk/settings/switches" },
  { path: "/desk/settings/permissions", role: "OWNER", fixture: "/desk/settings/permissions" },
  { path: "/desk/settings/approvals", role: "OWNER", fixture: "/desk/settings/approvals" },
  { path: "/desk/control-center", role: "OWNER", fixture: "/desk/control-center" },
  { path: "/desk/settings/price-changes", role: "OWNER", fixture: "/desk/settings/price-changes" },
  { path: "/desk/settings/goals", role: "OWNER", fixture: "/desk/settings/goals" },
  { path: "/desk/approvals", role: "OWNER", fixture: "/desk/approvals" },
  { path: "/desk/settings/unsigned-follow-up", role: "OWNER", fixture: "/desk/settings/unsigned-follow-up" },
  { path: "/desk/settings/policies", role: "OWNER", fixture: "/desk/settings/policies" },
  { path: "/desk/settings/preview-storage", role: "OWNER", fixture: "/desk/settings/preview-storage" },
  { path: "/desk/settings/telecom", role: "OWNER", fixture: "/desk/settings/telecom" },
  { path: "/desk/settings/website", role: "OWNER", fixture: "/desk/settings/website" },
  {
    path: "/desk/suppliers/[id]",
    role: "OWNER",
    fixture: "A generated supplier id",
    manualOnlyReason:
      "The CI seed does not create a deterministic supplier id; supplier lifecycle behavior is covered by supplier tests.",
  },
  { path: "/desk/suppliers/new", role: "OWNER", fixture: "/desk/suppliers/new" },
  { path: "/desk/suppliers", role: "OWNER", fixture: "/desk/suppliers" },
  { path: "/desk/sales-tax/areas", role: "OWNER", fixture: "/desk/sales-tax/areas" },
  { path: "/desk/sales-tax/area", role: "OWNER", fixture: "/desk/sales-tax/area" },
  { path: "/desk/sales-tax/benefits", role: "OWNER", fixture: "/desk/sales-tax/benefits" },
  { path: "/desk/sales-tax/delivery-fees", role: "OWNER", fixture: "/desk/sales-tax/delivery-fees" },
  { path: "/desk/sales-tax/exemptions", role: "OWNER", fixture: "/desk/sales-tax/exemptions" },
  { path: "/desk/sales-tax/returns", role: "OWNER", fixture: "/desk/sales-tax/returns" },
  {
    path: "/desk/sales-tax/returns/[periodId]",
    role: "OWNER",
    fixture: "A real private tax filing period in isolated PostgreSQL",
    manualOnlyReason: "The route requires a valid tax filing period ID; a static public ID does not exist.",
  },
  {
    path: "/desk/sales-tax/returns/[periodId]/amend",
    role: "OWNER",
    fixture: "A filed tax period with a detected open amendment",
    manualOnlyReason: "A realistic amendment needs an actual filed return and stored correction evidence.",
  },

  { path: "/desk/sales-tax", role: "OWNER", fixture: "/desk/sales-tax" },
  { path: "/desk/sales-tax/setup", role: "OWNER", fixture: "/desk/sales-tax/setup" },
  { path: "/desk/sales-tax/taxability", role: "OWNER", fixture: "/desk/sales-tax/taxability" },
  {
    path: "/desk/sales-tax/setup/accounts/[id]",
    role: "OWNER",
    fixture: "One tax filing account created in the isolated test database",
    manualOnlyReason:
      "An account editor needs a real private filing account id; static page inventory cannot assume an account exists.",
  },
  { path: "/desk/sales-tax/audit-pack", role: "OWNER", fixture: "/desk/sales-tax/audit-pack" },
  { path: "/desk/sales-tax/record-retention", role: "OWNER", fixture: "/desk/sales-tax/record-retention" },
  { path: "/desk/sales-tax/rules", role: "OWNER", fixture: "/desk/sales-tax/rules" },
  { path: "/desk/sales-tax/use-tax/settings", role: "OWNER", fixture: "/desk/sales-tax/use-tax/settings" },
  { path: "/desk/sales-tax/use-tax", role: "OWNER", fixture: "/desk/sales-tax/use-tax" },
  {
    path: "/desk/sales-tax/use-tax/[periodId]",
    role: "OWNER",
    fixture: "A generated consumer-use-tax filing period with a valid state account",
    manualOnlyReason:
      "A current private worksheet requires a generated consumer use-tax period id; its server-side authorization and packet behavior are verified separately.",
  },
  { path: "/desk/tasks", role: "OWNER", fixture: "/desk/tasks" },
  { path: "/desk/today", role: "OWNER", fixture: "/desk/today" },
];

export function automatedAccessibilityRoutes(role?: AccessibilityRouteRole) {
  return ACCESSIBILITY_ROUTES.filter(
    (route) => !route.manualOnlyReason && (!role || route.role === role),
  );
}

export function manualAccessibilityRoutes() {
  return ACCESSIBILITY_ROUTES.filter((route) => Boolean(route.manualOnlyReason));
}
