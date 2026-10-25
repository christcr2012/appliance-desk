import type { ExceptionItem } from "./rules";
import { listOpenResaleTaxFollowUps } from "@/domains/sales";

/**
 * One owner To do item (never one per sale, never blocking) while a sold retired appliance still needs a look from the
 * accountant: the tax history was missing or unconfirmed when it was sold. One open sale links straight to it.
 */
export async function listResaleTaxAttention(now: Date): Promise<ExceptionItem[]> {
  const open = await listOpenResaleTaxFollowUps();
  if (open.length === 0) return [];
  const single = open.length === 1 ? open[0] : null;
  return [{
    category: "RETIRED_SALE_TAX_REVIEW", severity: "medium",
    title: `Used appliance sales to go over with your accountant (${open.length})`,
    detail: "You sold a retired appliance before its tax history was confirmed. The sale went through normally; your accountant needs the tax basis and depreciation to work out the income-tax side. Open the sale to see the details, then tell the app once you have talked to your accountant.",
    href: single ? `/desk/sales/${single.invoiceId}` : "/desk/sales?followUp=1", since: single?.createdAt ?? now,
  }];
}
