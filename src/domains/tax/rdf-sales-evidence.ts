import type { Prisma } from "@prisma/client";
import { businessDateFromKey } from "@/lib/business-date";

type Tx = Prisma.TransactionClient;

/** Count one issued Colorado retail invoice line once, never one per tax jurisdiction. */
export async function recordedRetailSales(tx: Tx, year: number): Promise<number> {
  const lines = await tx.invoiceLineItem.findMany({
    where: {
      kind: {
        notIn: [
          "DEPOSIT",
          "TAX",
          "RETAIL_DELIVERY_FEE",
          "CREDIT",
          "PREPAY_DISCOUNT",
          "LATE_RETURN_WAIVER",
        ],
      },
      invoice: {
        agreement: { serviceAddress: { state: "CO" } },
        status: { notIn: ["DRAFT", "VOID", "WRITTEN_OFF"] },
        issuedAt: {
          gte: businessDateFromKey(`${year}-01-01`)!,
          lt: businessDateFromKey(`${year + 1}-01-01`)!,

        },
      },
    },
    select: { amountCents: true },
  });
  // Shop sales: picked up at the shop (Colorado) or delivered to a Colorado address.
  const shopLines = await tx.invoiceLineItem.findMany({
    where: {
      kind: { notIn: ["DEPOSIT", "TAX", "RETAIL_DELIVERY_FEE", "CREDIT", "PREPAY_DISCOUNT", "LATE_RETURN_WAIVER"] },
      invoice: {
        saleKind: "SHOP_SALE",
        status: { notIn: ["DRAFT", "VOID", "WRITTEN_OFF"] },
        issuedAt: { gte: businessDateFromKey(`${year}-01-01`)!, lt: businessDateFromKey(`${year + 1}-01-01`)! },
      },
    },
    select: { amountCents: true, invoice: { select: { saleLocation: true, saleServiceAddressId: true } } },
  });
  const addressIds = [...new Set(shopLines.flatMap((l) => (l.invoice.saleServiceAddressId ? [l.invoice.saleServiceAddressId] : [])))];
  const outside = new Set(
    addressIds.length ? (await tx.serviceAddress.findMany({ where: { id: { in: addressIds }, state: { not: "CO" } }, select: { id: true } })).map((a) => a.id) : [],
  );
  const shopTotal = shopLines.reduce((sum, l) => (l.invoice.saleServiceAddressId && outside.has(l.invoice.saleServiceAddressId) ? sum : sum + l.amountCents), 0);
  const total = shopTotal + lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (!Number.isSafeInteger(total))
    throw new Error("Sales total is outside integer cents range.");
  return Math.max(0, total);
}

