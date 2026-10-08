import type { Prisma } from "@prisma/client";

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
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    },
    select: { amountCents: true },
  });
  const total = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (!Number.isSafeInteger(total))
    throw new Error("Sales total is outside integer cents range.");
  return Math.max(0, total);
}

