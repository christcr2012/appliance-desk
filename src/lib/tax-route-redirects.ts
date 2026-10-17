/**
 * W-3: every tax screen now lives under the one "Taxes" menu entry (/desk/sales-tax). Bookmarks, emailed links and
 * browser history from before the move keep working: the old addresses forward to the new ones, query string kept.
 */
export const TAX_ROUTE_REDIRECTS = [
  { source: "/desk/tax/use-tax-worksheets", destination: "/desk/sales-tax/use-tax", permanent: true },
  { source: "/desk/tax/use-tax-worksheets/:periodId", destination: "/desk/sales-tax/use-tax/:periodId", permanent: true },
  { source: "/desk/tax/use-tax-settings", destination: "/desk/sales-tax/use-tax/settings", permanent: true },
  { source: "/desk/tax/audit-pack", destination: "/desk/sales-tax/audit-pack", permanent: true },
  { source: "/desk/tax/audit-pack/export", destination: "/desk/sales-tax/audit-pack/export", permanent: true },
  { source: "/desk/tax/record-retention", destination: "/desk/sales-tax/record-retention", permanent: true },
  { source: "/desk/tax", destination: "/desk/sales-tax", permanent: true },
] as const;
