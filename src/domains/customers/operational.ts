import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

/** Staff's customer context is a separate allowlisted query. Never pass the
 * owner record to a client component and merely conceal its money fields. */
export async function getOperationalCustomerById(id: string) {
  await requireRole("OWNER", "ADMIN", "STAFF");
  return prisma.customer.findUnique({
    where: { id },
    select: {
      id: true, phone: true, companyName: true,
      user: { select: { name: true, email: true } },
      serviceAddresses: { select: {
        id: true, line1: true, line2: true, city: true, state: true, zip: true,
      } },
      rentalAgreements: {
        select: { id: true, status: true, serviceAddressId: true },
        orderBy: [{ createdAt: "desc" }],
      },
      jobs: {
        select: { id: true, type: true, status: true, scheduledAt: true },
        orderBy: [{ scheduledAt: "desc" }],
      },
      contacts: { select: { id: true, name: true, role: true, phone: true, email: true } },
      notes: {
        select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
        orderBy: [{ createdAt: "desc" }], take: 100,
      },
    },
  });
}
