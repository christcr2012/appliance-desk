import { requireRole } from "@/lib/session";
import { detectDrift } from "@/domains/billing/reconciliation";

export async function loadBillingReconciliationPageData() {
  await requireRole("OWNER", "ADMIN");
  const checkedAt = new Date();
  const rows = await detectDrift();
  return { checkedAt, rows };
}
