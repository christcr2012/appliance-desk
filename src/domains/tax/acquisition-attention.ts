import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { ExceptionItem } from "@/domains/exceptions/rules";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

/** Two summary rows on Today, not one alert per appliance or purchase line. */
export async function listAcquisitionTaxAttention(
  now = new Date(),
): Promise<ExceptionItem[]> {
  await requireRole("OWNER", "ADMIN");
  const todayKey = businessDateKey(now);
  const todayStart = businessDateFromKey(todayKey);
  if (!todayStart) throw new Error("Unable to resolve today in Colorado.");
  const [unknownCount, oldestUnknown, due, overdue] = await Promise.all([
    prisma.appliance.count({ where: { acquisitionTaxStatus: "UNKNOWN" } }),
    prisma.appliance.findFirst({
      where: { acquisitionTaxStatus: "UNKNOWN" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { createdAt: true },
    }),
    prisma.purchaseUseTax.aggregate({
      where: { status: "DUE" },
      _sum: { useTaxDueCents: true },
      _count: { _all: true },
    }),
    prisma.purchaseUseTax.aggregate({
      where: {
        status: "DUE",
        filingPeriod: {
          status: "OPEN",
          OR: [
            { legalDueOn: { lt: todayStart } },
            { legalDueOn: null, dueOn: { lt: todayStart } },
          ],
        },
      },
      _sum: { useTaxDueCents: true },
      _count: { _all: true },
    }),
  ]);
  const result: ExceptionItem[] = [];
  if ¶»§q«^