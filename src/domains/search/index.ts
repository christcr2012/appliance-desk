import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Global search (2026-09-28) — the desk-wide search box's backing query.
// Looks across the things Chris is most likely typing a name, email, or
// asset number to find: customers, appliances, and leads. Deliberately
// NOT agreements or jobs — those don't have a name of their own to
// search by; they're found through the customer or appliance they
// belong to instead.
// ---------------------------------------------------------------------------

const RESULT_LIMIT = 8;

export type SearchResults = {
  query: string;
  customers: { id: string; name: string; email: string; companyName: string | null }[];
  appliances: { id: string; assetNumber: string; typeName: string; manufacturer: string | null }[];
  leads: { id: string; contactName: string; email: string | null; status: string }[];
};

/** Case-insensitive "contains" search across customers, appliances, and
 * leads, capped to a handful of results per category — this is a quick
 * jump-to lookup, not a full search results page with paging. A blank
 * or whitespace-only query returns nothing rather than every record. */
export async function searchAll(rawQuery: string): Promise<SearchResults> {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const query = rawQuery.trim();
  if (!query) {
    return { query: "", customers: [], appliances: [], leads: [] };
  }

  const [customers, appliances, leads] = await Promise.all([
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
      take: RESULT_LIMIT,
    }),
    prisma.lead.findMany({
      where: {
        OR: [
          { contactName: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
          { companyName: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, contactName: true, email: true, status: true },
      take: RESULT_LIMIT,
    }),
  ]);

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

