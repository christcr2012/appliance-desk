export type AccessibilityRole = "public" | "owner" | "customer";

export type AccessibilityFixture =
  | "none"
  | "test-customer"
  | "test-agreement"
  | "test-invoice"
  | "security-appliance"
  | "security-job";

export type AccessibilityRoute = {
  path: string;
  role: AccessibilityRole;
  fixture: AccessibilityFixture;
  manualOnlyReason?: string;
};

/**
 * Every current Next.js page route. Dynamic routes use stable CI fixtures when
 * the seed provides them; otherwise they stay visible here with a written
 * manual-only reason rather than silently disappearing from accessibility
 * coverage.
 */
export const ACCESSIBILITY_ROUTES: AccessibilityRoute[] = [
  { path: "/", role: "public", fixture: "none" },
  { path: "/accessibility", role: "public", fixture: "none" },
  { path: "/contact", role: "public", fixture: "none" },
  { path: "/how-it-works", role: "public", fixture: "none" },
  { path: "/launch", role: "public", fixture: "none" },
  { path: "/pricing", role: "public", fixture: "none" },
  { path: "/privacy", role: "public", fixture: "none" },
  {
    path: "/rent/[city]",
    role: "public",
    fixture: "none",
    manualOnlyReason: "Exists only for cities the owner has configured in the live service-area list.",
  },
  { path: "/service-area", role: "public", fixture: "none" },
  { path: "/terms", role: "public", fixture: "none" },

  { path: "/account", role: "customer", fixture: "none" },
  { path: "/account/billing", role: "customer", fixture: "none" },
  { path: "/account/billing/invoice/[invoiceId]", role: "customer", fixture: "test-invoice" },
  { path: "/account/maintenance", role: "customer", fixture: "none" },
  { path: "/account/rentals", role: "customer", fixture: "none" },
  { path: "/account/settings", role: "customer", fixture: "none" },
  { path: "/account/settings/privacy", role: "customer", fixture: "none" },

  { path: "/desk/activity", role: "owner", fixture: "none" },
  { path: "/desk/agreements", role: "owner", fixture: "none" },
  { path: "/desk/agreements/[id]", role: "owner", fixture: "test-agreement" },
  { path: "/desk/agreements/[id]/early-return", role: "owner", fixture: "test-agreement" },
  { path: "/desk/agreements/new", role: "owner", fixture: "none" },
  { path: "/desk/automations", role: "owner", fixture: "none" },
  { path: "/desk/billing", role: "owner", fixture: "none" },
  { path: "/desk/billing/customer/[id]", role: "owner", fixture: "test-customer" },
  { path: "/desk/billing/customer/[id]/invoice/[invoiceId]", role: "owner", fixture: "test-invoice" },
  {
    path: "/desk/billing/deposits/[id]",
    role: "owner",
    fixture: "none",
    manualOnlyReason: "Requires a real Deposit row in a refundable/decision state; the base CI fixture does not create one.",
  },
  { path: "/desk/billing/held-payments", role: "owner", fixture: "none" },
  { path: "/desk/billing/reconciliation", role: "owner", fixture: "none" },
  { path: "/desk/customers", role: "owner", fixture: "none" },
  { path: "/desk/customers/[id]", role: "owner", fixture: "test-customer" },
  { path: "/desk/customers/new", role: "owner", fixture: "none" },
  { path: "/desk/dashboard", role: "owner", fixture: "none" },
  { path: "/desk/dispatch", role: "owner", fixture: "none" },
  { path: "/desk/driver", role: "owner", fixture: "none" },
  { path: "/desk/estimates", role: "owner", fixture: "none" },
  {
    path: "/desk/estimates/[id]",
    role: "owner",
    fixture: "none",
    manualOnlyReason: "Requires an estimate with domain-specific lifecycle state not created by the base CI seed.",
  },
  { path: "/desk/estimates/new", role: "owner", fixture: "none" },
  { path: "/desk/fleet", role: "owner", fixture: "none" },
  { path: "/desk/growth", role: "owner", fixture: "none" },
  { path: "/desk/inventory", role: "owner", fixture: "none" },
  { path: "/desk/inventory/[id]", role: "owner", fixture: "security-appliance" },
  { path: "/desk/inventory/[id]/qr", role: "owner", fixture: "security-appliance" },
  { path: "/desk/jobs", role: "owner", fixture: "none" },
  { path: "/desk/jobs/[id]", role: "owner", fixture: "security-job" },
  { path: "/desk/jobs/[id]/work-order", role: "owner", fixture: "security-job" },
  { path: "/desk/jobs/new", role: "owner", fixture: "none" },
  { path: "/desk/launch", role: "owner", fixture: "none" },
  { path: "/desk/leads", role: "owner", fixture: "none" },
  {
    path: "/desk/leads/[id]",
    role: "owner",
    fixture: "none",
    manualOnlyReason: "Requires a lead record; the base CI seed intentionally contains no live lead fixture.",
  },
  { path: "/desk/leads/new", role: "owner", fixture: "none" },
  { path: "/desk/maintenance", role: "owner", fixture: "none" },
  {
    path: "/desk/maintenance/[id]",
    role: "owner",
    fixture: "none",
    manualOnlyReason: "Requires a maintenance request with lifecycle-specific related data not present in the base CI seed.",
  },
  { path: "/desk/notices", role: "owner", fixture: "none" },
  {
    path: "/desk/notices/[id]/resolve",
    role: "owner",
    fixture: "none",
    manualOnlyReason: "Requires a missed/uncertain/failed notice; creating one changes legal-evidence state and is covered by notice integration tests.",
  },
  { path: "/desk/parts", role: "owner", fixture: "none" },
  {
    path: "/desk/parts/[id]",
    role: "owner",
    fixture: "none",
    manualOnlyReason: "Requires a persisted part ledger record; the base CI seed does not create purchasing inventory.",
  },
  { path: "/desk/privacy", role: "owner", fixture: "none" },
  { path: "/desk/purchase-orders", role: "owner", fixture: "none" },
  {
    path: "/desk/purchase-orders/[id]",
    role: "owner",
    fixture: "none",
    manualOnlyReason: "Requires a persisted purchase order; the base CI seed intentionally leaves purchasing data empty.",
  },
  { path: "/desk/purchase-orders/new", role: "owner", fixture: "none" },
  { path: "/desk/reports", role: "owner", fixture: "none" },
  { path: "/desk/revenue", role: "owner", fixture: "none" },
  { path: "/desk/search", role: "owner", fixture: "none" },
  { path: "/desk/settings", role: "owner", fixture: "none" },
  { path: "/desk/settings/policies", role: "owner", fixture: "none" },
  {
    path: "/desk/settings/preview-storage",
    role: "owner",
    fixture: "none",
    manualOnlyReason: "Intentionally returns 404 unless isolated preview-storage credentials are configured.",
  },
  { path: "/desk/settings/website", role: "owner", fixture: "none" },
  { path: "/desk/suppliers", role: "owner", fixture: "none" },
  {
    path: "/desk/suppliers/[id]",
    role: "owner",
    fixture: "none",
    manualOnlyReason: "Requires a persisted supplier; the base CI seed intentionally leaves supplier data empty.",
  },
  { path: "/desk/suppliers/new", role: "owner", fixture: "none" },
  { path: "/desk/tasks", role: "owner", fixture: "none" },
  { path: "/desk/today", role: "owner", fixture: "none" },

  {
    path: "/estimate/[id]",
    role: "public",
    fixture: "none",
    manualOnlyReason: "Requires a sent estimate link in a valid lifecycle state; estimate acceptance tests create these transactionally.",
  },
  { path: "/forgot-password", role: "public", fixture: "none" },
  {
    path: "/launch/confirm/[token]",
    role: "public",
    fixture: "none",
    manualOnlyReason: "Requires a single-use unexpired confirmation token, so the route is exercised by launch confirmation tests.",
  },
  { path: "/login", role: "public", fixture: "none" },
  { path: "/reset-password", role: "public", fixture: "none" },
  {
    path: "/scan/[assetNumber]",
    role: "public",
    fixture: "none",
    manualOnlyReason: "The route intentionally redirects according to authentication/rental ownership; QR routing has dedicated security tests.",
  },
  {
    path: "/sign/[id]",
    role: "public",
    fixture: "none",
    manualOnlyReason: "Requires an unsigned signature record and is covered by signing lifecycle/browser tests.",
  },
];
