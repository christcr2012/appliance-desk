import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { jobRoleScreens } from "@/lib/job-role-guard";
import { jobRoleAllowsScreen, type ScreenKey } from "@/domains/team/job-role-rules";

const RESULT_LIMIT = 8;

export type SearchResults = {
  query: string;
  customers: { id: string; name: string; email: string; companyName: string | null }[];
  appliances: { id: string; assetNumber: string; typeName: string; manufacturer: string | null }[];
  leads: { id: string; contactName: string; email: string | null; status: string }[];
  /** W-17: owner/admin only; always empty for staff. */
  purchases: { id: string; seller: string; reference: string | null; purchasedOn: Date }[];
  sellers: { id: string; name: string; contactName: string | null }[];
};

/**
 * Desk-wide quick lookup. Search is a data-access surface, so the categories
 * follow the same role policy as their destination pages: OWNER/ADMIN may see
 * leads; STAFF may search operational customers/appliances but never queries
 * Lead at all.
 */
export async function searchAll(rawQuery: string): Promise<SearchResults> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  // ACC-5: a job role only narrows. A category the person's job role does not include is not even queried (take: 0).
  const screens = await jobRoleScreens(session.user.id, session.user.role);
  const limitFor = (screen: ScreenKey) => (jobRoleAllowsScreen(screens, screen) ? RESULT_LIMIT : 0);
  const query = rawQuery.trim();
  if (!query) {
    return { query: "", customers: [], appliances: [], leads: [], purchases: [], sellers: [] };
  }

  const [customers, appliances] = await Promise.all([
    prisma.customer.findMany({
      where: {
        archivedAt: null,
        isWalkIn: false,
        OR: [
          { user: { name: { contains: query, mode: "insensitive" } } },
          { user: { email: { contains: query, mode: "insensitive" } } },
          { companyName: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, companyName: true, user: { select: { name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limitFor("customers"),
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
      take: limitFor("inventory"),
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
          take: limitFor("leads"),
        })
      : [];

  // Purchases and sellers carry money and seller details: never queried for staff.
  const isOwnerOrAdmin = session.user.role === "OWNER" || session.user.role === "ADMIN";
  const purchases = isOwnerOrAdmin
    ? await prisma.purchase.findMany({
        where: {
          OR: [
            { sellerName: { contains: query, mode: "insensitive" } },
            { reference: { contains: query, mode: "insensitive" } },
            { supplier: { name: { contains: query, mode: "insensitive" } } },
          ],
        },
        select: { id: true, sellerName: true, reference: true, purchasedOn: true, supplier: { select: { name: true } } },
        orderBy: [{ purchasedOn: "desc" }, { id: "desc" }],
        take: limitFor("inventory"),
      })
    : [];
  const sellers = isOwnerOrAdmin
    ? await prisma.supplier.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { contactName: { contains: query, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, contactName: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: limitFor("suppliers"),
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
    purchases: purchases.map((p) => ({
      id: p.id,
      seller: p.supplier?.name ?? p.sellerName ?? "Seller not named",
      reference: p.reference,
      purchasedOn: p.purchasedOn,
    })),
    sellers,
    leads: leads.map((l) => ({
      id: l.id,
      contactName: l.contactName,
      email: l.email,
      status: l.status,
    })),
  };
}
