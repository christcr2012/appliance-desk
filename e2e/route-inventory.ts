export type AccessibilityRouteRole = "PUBLIC" | "OWNER" | "CUSTOMER";

export type AccessibilityRoute = {
  /** Next.js route template, kept in sync with every src/app/**/page.tsx file. */
  path: string;
  role: AccessibilityRouteRole;
  /** Navigable CI fixture. Symbolic ids are resolved by the generated axe specs. */
  fixture: string;
  /** A route may be manual-only only when CI has no safe stable fixture for its real state. */
  manualOnlyReason?: string;
};

export const ACCESSIBILITY_ROUTES: readonly AccessibilityRoute[] = [
  { path: "/", role: "PUBLIC", fixture: "/" },
  { path: "/accessibility", role: "PUBLIC", fixture: "/accessibility" },
  { path: "/contact", role: "PUBLIC", fixture: "/contact" },
  { path: "/how-it-works", role: "PUBLIC", fixture: "/how-it-works" },
  { path: "/launch", role: "PUBLIC", fixture: "/launch" },
  { path: "/pricing", role: "PUBLIC", fixture: "/pricing" },
  { path: "/privacy", role: "PUBLIC", fixture: "/privacy" },
  { path: "/rent/[city]", role: "PUBLIC", fixture: "/rent/denver" },
  { path: "/service-area", role: "PUBLIC", fixture: "/service-area" },
  { path: "/terms", role: "PUBLIC", fixture: "/terms" },
  { path: "/estimate/[id]", role: "PUBLIC", fixture: "/estimate/__ESTIMATE_ID__", manualOnlyReason: "A real estimate fixture requires the estimate creation flow and customer-specific pricing evidence." },
  { path: "/forgot-password", role: "PUBLIC", fixture: "/forgot-password" },
  { path: "/launch/confirm/[token]", role: "PUBLIC", fixture: "/launch/confirm/invalid-ci-token" },
  { path: "/login", role: "PUBLIC", fixture: "/login" },
  { path: "/reset-password", role: "PUBLIC", fixture: "/reset-password" },
  { path: "/scan/[assetNumber]", role: "PUBLIC", fixture: "/scan/CI-SECURITY-UNIT" },
  { path: "/sign/[id]", role: "PUBLIC", fixture: "/sign/__AGREEMENT_ID__", manualOnlyReason: "The signing page requires a purpose-built unsigned agreement; the standard CI agreement is already active." },

  { path: "/account", role: "CUSTOMER", fixture: "/account" },
  { path: "/account/billing", role: "CUSTOMER", fixture: "/account/billing" },
  { path: "/account/billing/invoice/[invoiceId]", role: "CUSTOMER", fixture: "/account/billing/invoice/__CUSTOMER_INVOICE_ID__" },
  { path: "/account/maintenance", role: "CUSTOMER", fixture: "/account/maintenance" },
  { path: "/account/rentals", role: "CUSTOMER", fixture: "/account/rentals" },
  { path: "/account/settings", role: "CUSTOMER", fixture: "/account/settings" },
  { path: "/account/settings/privacy", role: "CUSTOMER", fixture: "/account/settings/privacy" },

  { path: "/desk/activity", role: "OWNER", fixture: "/desk/activity" },
  { path: "/desk/agreements", role: "OWNER", fixture: "/desk/agreements" },
  { path: "/desk/agreements/[id]", role: "OWNER", fixture: "/desk/agreements/__AGREEMENT_ID__" },
  { path: "/desk/agreements/[id]/early-return", role: "OWNER", fixture: "/desk/agreements/__AGREEMENT_ID__/early-return" },
  { path: "/desk/agreements/new", role: "OWNER", fixture: "/desk/agreements/new" },
  { path: "/desk/automations", role: "OWNER", fixture: "/desk/automations" },
  { path: "/desk/billing", role: "OWNER", fixture: "/desk/billing" },
  { path: "/desk/billing/customer/[id]", role: "OWNER", fixture: "/desk/billing/customer/__CUSTOMER_ID__" },
  { path: "/desk/billing/customer/[id]/invoice/[invoiceId]", role: "OWNER", fixture: "/desk/billing/customer/__CUSTOMER_ID__/invoice/__CUSTOMER_INVOICE_ID__" },
  { path: "/desk/billing/deposits/[id]", role: "OWNER", fixture: "/desk/billing/deposits/__DEPOSIT_ID__", manualOnlyReason: "The default CI customer fixture has a deposit amount but no settled deposit-liability record with a stable id." },
  { path: "/desk/billing/held-payments", role: "OWNER", fixture: "/desk/billing/held-payments" },
  { path: "/desk/billing/reconciliation", role: "OWNER", fixture: "/desk/billing/reconciliation" },
  { path: "/desk/customers", role: "OWNER", fixture: "/desk/customers" },
  { path: "/desk/customers/[id]", role: "OWNER", fixture: "/desk/customers/__CUSTOMER_ID__" },
  { path: "/desk/customers/new", role: "OWNER", fixture: "/desk/customers/new" },
  { path: "/desk/dashboard", role: "OWNER", fixture: "/desk/dashboard" },
  { path: "/desk/dispatch", role: "OWNER", fixture: "/desk/dispatch" },
  { path: "/desk/driver", role: "OWNER", fixture: "/desk/driver" },
  { path: "/desk/estimates", role: "OWNER", fixture: "/desk/estimates" },
  { path: "/desk/estimates/[id]", role: "OWNER", fixture: "/desk/estimates/__ESTIMATE_ID__", manualOnlyReason: "The CI seed does not create an estimate; estimate-detail accessibility is exercised manually with a disposable estimate." },
  { path: "/desk/estimates/new", role: "OWNER", fixture: "/desk/estimates/new" },
  { path: "/desk/fleet", role: "OWNER", fixture: "/desk/fleet" },
  { path: "/desk/growth", role: "OWNER", fixture: "/desk/growth" },
  { path: "/desk/inventory", role: "OWNER", fixture: "/desk/inventory" },
  { path: "/desk/inventory/[id]", role: "OWNER", fixture: "/desk/inventory/ci-security-appliance" },
  { path: "/desk/inventory/[id]/qr", role: "OWNER", fixture: "/desk/inventory/ci-security-appliance/qr" },
  { path: "/desk/jobs", role: "OWNER", fixture: "/desk/jobs" },
  { path: "/desk/jobs/[id]", role: "OWNER", fixture: "/desk/jobs/ci-security-job" },
  { path: "/desk/jobs/[id]/work-order", role: "OWNER", fixture: "/desk/jobs/ci-security-job/work-order" },
  { path: "/desk/jobs/new", role: "OWNER", fixture: "/desk/jobs/new" },
  { path: "/desk/launch", role: "OWNER", fixture: "/desk/launch" },
  { path: "/desk/leads", role: "OWNER", fixture: "/desk/leads" },
  { path: "/desk/leads/[id]", role: "OWNER", fixture: "/desk/leads/__LEAD_ID__", manualOnlyReason: "The default CI seed deliberately does not create a lead with real-contact history." },
  { path: "/desk/leads/new", role: "OWNER", fixture: "/desk/leads/new" },
  { path: "/desk/maintenance", role: "OWNER", fixture: "/desk/maintenance" },
  { path: "/desk/maintenance/[id]", role: "OWNER", fixture: "/desk/maintenance/__MAINTENANCE_ID__", manualOnlyReason: "The CI seed has no standalone maintenance-request record; the job fixture covers field-work accessibility." },
  { path: "/desk/notices", role: "OWNER", fixture: "/desk/notices" },
  { path: "/desk/notices/[id]/resolve", role: "OWNER", fixture: "/desk/notices/__NOTICE_ID__/resolve", manualOnlyReason: "Notice resolution requires a live waiting/uncertain legal-notice fixture and must not mutate the shared seed implicitly." },
  { path: "/desk/parts", role: "OWNER", fixture: "/desk/parts" },
  { path: "/desk/parts/[id]", role: "OWNER", fixture: "/desk/parts/__PART_ID__", manualOnlyReason: "The default CI seed does not guarantee a stable part id." },
  { path: "/desk/privacy", role: "OWNER", fixture: "/desk/privacy" },
  { path: "/desk/purchase-orders", role: "OWNER", fixture: "/desk/purchase-orders" },
  { path: "/desk/purchase-orders/[id]", role: "OWNER", fixture: "/desk/purchase-orders/__PO_ID__", manualOnlyReason: "The default CI seed does not create a purchase order; review this route with a disposable PO before release." },
  { path: "/desk/purchase-orders/new", role: "OWNER", fixture: "/desk/purchase-orders/new" },
  { path: "/desk/reports", role: "OWNER", fixture: "/desk/reports" },
  { path: "/desk/revenue", role: "OWNER", fixture: "/desk/revenue" },
  { path: "/desk/search", role: "OWNER", fixture: "/desk/search" },
  { path: "/desk/settings", role: "OWNER", fixture: "/desk/settings" },
  { path: "/desk/settings/policies", role: "OWNER", fixture: "/desk/settings/policies" },
  { path: "/desk/settings/preview-storage", role: "OWNER", fixture: "/desk/settings/preview-storage" },
  { path: "/desk/settings/website", role: "OWNER", fixture: "/desk/settings/website" },
  { path: "/desk/suppliers", role: "OWNER", fixture: "/desk/suppliers" },
  { path: "/desk/suppliers/[id]", role: "OWNER", fixture: "/desk/suppliers/__SUPPLIER_ID__", manualOnlyReason: "The default CI seed does not guarantee a stable supplier id." },
  { path: "/desk/suppliers/new", role: "OWNER", fixture: "/desk/suppliers/new" },
  { path: "/desk/tasks", role: "OWNER", fixture: "/desk/tasks" },
  { path: "/desk/today", role: "OWNER", fixture: "/desk/today" },
] as const;

export const AUTOMATED_ACCESSIBILITY_ROUTES = ACCESSIBILITY_ROUTES.filter(
  (route) => !route.manualOnlyReason,
);

export const MANUAL_ACCESSIBILITY_ROUTES = ACCESSIBILITY_ROUTES.filter(
  (route) => Boolean(route.manualOnlyReason),
);
