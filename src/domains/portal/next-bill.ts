import { prisma } from "@/lib/prisma";

/** W-20: what the next monthly bill will be for rent, per current rental. Tax and credits are on the bill itself. */
export type NextBill = { agreementId: string; addressLabel: string; rentCents: number; date: Date };

export function rentForNextBill(lines: { monthlyPriceCents: number }[]): number {
  return lines.reduce((sum, line) => sum + line.monthlyPriceCents, 0);
}

export async function getNextBills(customerId: string, addressId?: string): Promise<NextBill[]> {
  const agreements = await prisma.rentalAgreement.findMany({
    where: { customerId, status: "ACTIVE", nextBillingDate: { not: null }, ...(addressId ? { serviceAddressId: addressId } : {}) },
    select: {
      id: true, nextBillingDate: true,
      serviceAddress: { select: { line1: true, city: true } },
      lines: { select: { monthlyPriceCents: true } },
    },
    orderBy: [{ nextBillingDate: "asc" }, { id: "asc" }], take: 6,
  });
  return agreements.flatMap((a) => {
    const rent = rentForNextBill(a.lines);
    return a.nextBillingDate && rent > 0
      ? [{ agreementId: a.id, addressLabel: a.serviceAddress.line1 + ", " + a.serviceAddress.city, rentCents: rent, date: a.nextBillingDate }]
      : [];
  });
}
