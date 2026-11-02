import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

/**
 * AR-6b section 7: the suppliers list read.
 *
 * Replaces getSuppliers on the list page (every supplier, unbounded).
 * Cursor-paged on (name asc, id asc). The "{n} orders" count keeps the
 * meaning the pre-AR-6b surfaces showed: purchase orders plus appliance
 * purchases from that supplier.
 *
 * getSuppliers itself stays: the purchase and order forms use it as
 * their (bounded, active-only) supplier picker source.
 */

export type SupplierListStatus = "active" | "archived";

export type SupplierPageParams = {
  status?: SupplierListStatus;
  /** Matches the supplier name or its contact person. */
  q?: string;
  cursor?: { name: string; id: string };
  take?: number;
};

export type SupplierPageRow = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  archived: boolean;
  /** Purchase orders + appliance purchases from this supplier. */
  orderCount: number;
};

export async function getSuppliersPage(
  params: SupplierPageParams = {},
): Promise<{ rows: SupplierPageRow[]; nextCursor: { name: string; id: string } | null }> {
  await requireRole("OWNER", "ADMIN");
  const take = Math.min(Math.max(params.take ?? 50, 1), 200);
  const q = params.q?.trim();
  const page = await prisma.supplier.findMany({
    where: {
      archivedAt: params.status === "archived" ? { not: null } : null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { contactName: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(params.cursor
        ? {
            OR: [
              { name: { gt: params.cursor.name } },
              { name: params.cursor.name, id: { gt: params.cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: take + 1,
    select: {
      id: true,
      name: true,
      contactName: true,
      phone: true,
      email: true,
      archivedAt: true,
      _count: { select: { purchaseOrders: true, purchases: true } },
    },
  });
  const hasMore = page.length > take;
  const rows = (hasMore ? page.slice(0, take) : page).map((s) => ({
    id: s.id,
    name: s.name,
    contactName: s.contactName,
    phone: s.phone,
    email: s.email,
    archived: s.archivedAt !== null,
    orderCount: s._count.purchaseOrders + s._count.purchases,
  }));
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor: hasMore && last ? { name: last.name, id: last.id } : null,
  };
}
