/**
 * Pure money helpers, deliberately kept in their own file with NO
 * database import (unlike the rest of src/domains/pricing). A "use
 * client" component that imports from ./index would also pull in
 * @/lib/prisma's module-level PrismaClient setup (and the `pg` driver
 * underneath it) into the browser bundle — that's exactly what broke
 * the production build for /desk/agreements' client-side detail panel
 * (Vercel error: "Module not found: Can't resolve 'util/types'" from
 * node_modules/pg/lib/utils.js). Client components must import
 * formatCents/dollarsToCents from here, never from "@/domains/pricing".
 */

/**
 * Dollars (as a human types them, e.g. 45 or 45.5) → integer cents.
 * The one place this conversion happens for /desk/settings' fee and
 * appliance-price forms, which are entered in dollars for a human but
 * always stored as integer cents — see docs/BUSINESS-RULES.md ("money
 * is stored as integer cents, never floating point").
 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Cents → "$35" / "$34.50". Money is always integer cents — see docs/BUSINESS-RULES.md. */
export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Cents → "35.00" / "-34.50" — a plain decimal with no "$" and no
 * thousands separator, always two decimal places. For a CSV export
 * (Task #73's accounting export) rather than on-screen display: a
 * spreadsheet or bookkeeping tool reads this as a real number, where
 * formatCents' "$1,234.00" would come in as text in some importers. */
export function formatCentsAsPlainDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}
