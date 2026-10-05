import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const RESULT_LIMIT = 8;

export type SearchResults = {
  query: string;
  customers: { id: string; name: string; email: string; companyName: string | null }[];
  appliances: { id: string; assetNumber: string; typeName: string; manufacturer: string | null }[];
  leads: { id: string; contactName: string; email: string | null; status: string }[];
};

/**
 * Desk-wide quick lookup. Search is a data-access surface, so the categories
 * follow the same role policy as their destination pages: OWNER/ADMIN may see
 * leads; STAFF may search operational customers/appliances but never queries
 * Lead at all.
 */
export async function searchAll(rawQuery: string): Promise<SearchResults> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const query = rawQuery.trim();
  if (!query) {
    return { query: "", customers: [], appliances: [], leads: [] };
  }

  const [customers, appliances] = await Promise.all([
    prisma.customer.findMany({
      where: {
        archivedAt: null,
        OR: [
          { user: { name: { contains: query, mode: "insensitive" } } },
          { user: { email: { contains: query, mode: "insensitive" } } },
          { companyName: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, companyName: true, user: { select: { name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RESULT_LIMIT,
    }),
    prisma.appliance.findMany({
      where: {
        OR: [
          { assetNumber: { contains: query, mode: "insensitive" } },
          { manufacturer: { contains: query, mode: "insensitive" } },
          { model: { contains: query, mode: "insensitive" } },
          { serialNumber: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, assetNumber: true, manufacturer: true, applianceType: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RESULT_LIMIT,
    }),
  ]);

  const leads =
    session.user.role === "OWNER" || session.user.role === "ADMIN"
      ? await prisma.lead.findMany({
          where: {
            OR: [
              { contactName: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { companyName: { contains: query, mode: "insensitive" } },
            ],
          },
          select: { id: true, contactName: true, email: true, status: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: RESULT_LIMIT,
        })
      : [];

  return {
    query,
    customers: customers.map((c) => ({
      id: c.id,
      name: c.user.name ?? c.user.email,
      email: c.user.email,
      companyName: c.companyName,
    })),
    appliances: appliances.map((a) => ({
      id: a.id,
      assetNumber: a.assetNumber,
      typeName: a.applianceType.name,
      manufacturer: a.manufacturer,
    })),
    leads: leads.map((l) => ({
      id: l.id,
      contactName: l.contactName,
      email: l.email,
      status: l.status,
    })),
  };
}
