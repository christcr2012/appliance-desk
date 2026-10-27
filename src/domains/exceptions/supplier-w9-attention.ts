import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { ExceptionItem } from "./rules";

type Rows = { rows: ExceptionItem[]; total: number };

function bounded(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("A bounded task limit is required.");
}

/**
 * CMP-3: paying a 1099-marked supplier who has no W-9 on file. Federal
 * backup withholding (24%, the researched rate in the compliance research
 * file) applies to reportable payments made without a TIN, so the To do
 * appears as soon as the supplier has a posted payment in the current or
 * previous calendar year — the two years a 1099 can still be prepared
 * for — and clears itself the day the W-9 is recorded. Read-only, like
 * every provider.
 */
export async function listSupplierW9Needed(limit: number, now: Date): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const windowStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
  const paidSupplierIds = (
    await prisma.expense.findMany({
      where: { status: "POSTED", supplierId: { not: null }, spentOn: { gte: windowStart } },
      select: { supplierId: true },
      distinct: ["supplierId"],
    })
  ).map((e) => e.supplierId!);
  if (paidSupplierIds.length === 0) return { rows: [], total: 0 };
  const where = {
    id: { in: paidSupplierIds },
    is1099Vendor: true,
    w9ReceivedOn: null,
    archivedAt: null,
  };
  const suppliers = await prisma.supplier.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, name: true, createdAt: true },
  });
  return {
    rows: suppliers.map((s): ExceptionItem => ({
      category: "SUPPLIER_TAX_ID",
      severity: "medium",
      title: `Get a W-9 from ${s.name} before paying`,
      detail:
        "You have paid this 1099 supplier and there is no W-9 on file. Without one, 24% backup withholding applies to reportable payments. Ask for the W-9 from the supplier's page.",
      href: "/desk/suppliers/" + encodeURIComponent(s.id),
      since: s.createdAt,
    })),
    total: suppliers.length < limit ? suppliers.length : await prisma.supplier.count({ where }),
  };
}
