import type { InvoiceLineItemKind, Prisma } from "@prisma/client";
import systemChart from "./system-chart.json";

export const SYSTEM_ACCOUNTS = systemChart.accounts;
export const DEFAULT_EXPENSE_CATEGORIES = systemChart.categories;

/** Monetary/accounting mapping, never presentation or tax classification. */
export function lineKindAccountRole(
  kind: InvoiceLineItemKind,
  amountCents: number,
): string | "TAX_LINES" | "SKIP" {
  if (!Number.isSafeInteger(amountCents)) throw new Error("Book line amount must be integer cents.");
  switch (kind) {
    case "RENTAL": return "RENTAL_INCOME";
    case "LATE_RETURN": return "LATE_RETURN_INCOME";
    case "LATE_RETURN_WAIVER": return "DISCOUNTS";
    case "DELIVERY_FEE": return "DELIVERY_INCOME";
    case "INSTALLATION_FEE": return "INSTALLATION_INCOME";
    case "REMOVAL_FEE": return "REMOVAL_INCOME";
    case "HAUL_AWAY_FEE": return "REMOVAL_INCOME"; // FEETAX-1: haul-away is removal-type service income; no separate chart account.
    case "DAMAGE_WAIVER": return "DAMAGE_WAIVER_INCOME";
    case "LATE_FEE": return "LATE_FEE_INCOME";
    case "EARLY_TERMINATION_FEE": return "EARLY_TERMINATION_INCOME";
    case "PREPAY_DISCOUNT": return "DISCOUNTS";
    case "CREDIT": return "CUSTOMER_CREDITS";
    case "ADJUSTMENT": return amountCents >= 0 ? "OTHER_INCOME" : "DISCOUNTS";
    case "ADMIN_SETUP_FEE": return "OTHER_INCOME"; // Tax classification remains ADMINISTRATIVE_SETUP.
    case "RETAIL_DELIVERY_FEE": return "RETAIL_DELIVERY_FEE_PAYABLE"; // Collected on the state's behalf.
    case "TAX": return "TAX_LINES";
    case "DEPOSIT": return "SKIP"; // Deposits are never earned rent.
    case "MERCHANDISE": return "MERCHANDISE_INCOME";
    case "USED_APPLIANCE": return "RETIRED_APPLIANCE_SALES";
    default: {
      const invalid: never = kind;
      throw new Error("Unmapped invoice item kind: " + invalid);
    }
  }
}

type AccountLookup = Pick<Prisma.TransactionClient, "ledgerAccount">;
const perTransaction = new WeakMap<object, Map<string, string>>();

/** Cache only within the passed transaction; never across a role downgrade or a request. */
export async function accountIdForRole(tx: AccountLookup, role: string): Promise<string> {
  let cache = perTransaction.get(tx);
  if (!cache) { cache = new Map(); perTransaction.set(tx, cache); }
  const cached = cache.get(role);
  if (cached) return cached;
  // Owner-created account IDs are passed explicitly; never mistake a name for a stable account identity.
  const customId = role.startsWith("ID:") ? role.slice(3) : null;
  const account = customId
    ? await tx.ledgerAccount.findUnique({where:{id:customId},select:{id:true,active:true}})
    : await tx.ledgerAccount.findUnique({where:{systemRole:role},select:{id:true,active:true}});
  if (!account?.active) throw new Error("Missing or inactive ledger account role: " + role);
  cache.set(role, account.id);
  return account.id;
}

/** New tax filing accounts receive separate sales/use liabilities without modifying renamed accounts. */
export async function ensureTaxLiabilityAccounts(tx: Pick<Prisma.TransactionClient,"ledgerAccount"|"taxFilingAccount">) {
  const filings = await tx.taxFilingAccount.findMany({ select: { id: true, name: true } });
  for (const filing of filings) {
    for (const item of [
      { prefix: "SALES_TAX", label: "Sales tax owed — " },
      { prefix: "USE_TAX", label: "Use tax owed — " },
    ]) {
      const role = item.prefix + ":" + filing.id;
      await tx.ledgerAccount.upsert({
        where: { systemRole: role },
        create: { systemRole: role, name: item.label + filing.name,
          type: "LIABILITY", description: item.label + filing.name, filingAccountId: filing.id },
        update: {},
      });
    }
  }
}
