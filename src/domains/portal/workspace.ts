import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
import { ACTIVE_ASSIGNMENT_WHERE } from "@/domains/agreements/active-appliances";
import { rentalMonthlyTotalCents } from "@/domains/agreements/totals";
import { getNextBills } from "@/domains/portal/next-bill";
/** Session identity is resolved here; URL property filters can only narrow
 * the signed-in customer's own records. Only customer-visible DTOs are read. */
export async function getPortalHome(rawAddressId?: string) {
  const session = await getServerSession();
  if (!session) return null;
  const customer = await prisma.customer.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      archivedAt: true,
      serviceAddresses: {
        select: { id: true, line1: true, line2: true, city: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!customer || customer.archivedAt) return null;
  const addressId = customer.serviceAddresses.some((a) => a.id === rawAddressId)
    ? rawAddressId
    : undefined;
  const rentalWhere = {
    customerId: customer.id,
    status: "ACTIVE" as const,
    ...(addressId ? { serviceAddressId: addressId } : {}),
  };
  const jobWhere = {
    customerId: customer.id,
    status: {
      in: ["SCHEDULED", "IN_PROGRESS"] as ("SCHEDULED" | "IN_PROGRESS")[],
    },
    ...(addressId ? { serviceAddressId: addressId } : {}),
  };
  const now = new Date();
  const [
    activeRentalCount,
    upcomingVisitCount,
    nextVisit,
    rentals,
    invoice,
    openRequestCount,
    openVisits,
    nextBills,
    awaitingSignature,
    allActiveRentals,
  ] = await Promise.all([
    prisma.rentalAgreement.count({ where: rentalWhere }),
    prisma.job.count({ where: jobWhere }),
    prisma.job.findFirst({
      where: { ...jobWhere, scheduledAt: { gte: now } },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      select: {
        type: true,
        status: true,
        scheduledAt: true,
        customerPickupHandoff: true,
        serviceAddress: { select: { line1: true, line2: true, city: true } },
      },
    }),
    prisma.rentalAgreement.findMany({
      where: rentalWhere,
      take: 6,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        serviceAddress: { select: { line1: true, line2: true, city: true } },
        lines: {
          select: {
            label: true, monthlyPriceCents: true, packageId: true,
            assignments: { where: ACTIVE_ASSIGNMENT_WHERE, select: { appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } } } },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
        // W-21A: machines away for repair with no replacement yet, so the customer knows a credit is coming.
        outOfServicePeriods: {
          where: { endedOn: null },
          select: { id: true, startedOn: true, appliance: { select: { applianceType: { select: { name: true } } } } },
        },
      },
    }),
    prisma.invoice.findFirst({
      where: {
        customerId: customer.id,
        status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT", "FAILED"] },
        ...(addressId ? { agreement: { serviceAddressId: addressId } } : {}),
      },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        amountDueCents: true,
        amountPaidCents: true,
        dueDate: true,
        stripeInvoiceId: true,
        saleKind: true,
      },
    }),
    prisma.maintenanceRequest.count({
      where: {
        customerId: customer.id,
        status: { in: ["SUBMITTED", "REVIEWING", "SCHEDULED", "IN_PROGRESS"] },
      },
    }),
    // W-20: a short requested -> scheduled -> done picture for each open visit.
    prisma.job.findMany({
      where: jobWhere, take: 5,
      orderBy: [{ scheduledAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      select: { id: true, type: true, status: true, createdAt: true, scheduledAt: true, customerPickupHandoff: true },
    }),
    getNextBills(customer.id, addressId),
    prisma.rentalAgreement.findMany({
      where: { customerId: customer.id, status: "AWAITING_SIGNATURE" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, signature: { select: { id: true } } },
    }),
    prisma.rentalAgreement.findMany({
      where: rentalWhere,
      select: { lines: { select: { monthlyPriceCents: true } } },
    }),
  ]);
  return {
    customerId: customer.id,
    properties: customer.serviceAddresses,
    addressId,
    activeRentalCount,
    upcomingVisitCount,
    nextVisit,
    rentals: rentals.map((rental) => ({
      ...rental,
      monthlyTotalCents: rentalMonthlyTotalCents(rental.lines),
    })),
    // The whole account's monthly rent (every active rental in scope,
    // not just the six shown), summed in the domain.
    monthlyTotalCents: allActiveRentals.reduce(
      (sum, rental) => sum + rentalMonthlyTotalCents(rental.lines),
      0,
    ),
    // The raw Stripe invoice id and the sale kind stay inside the
    // domain: the page receives the derived flags (isLocalInvoice /
    // isShopSale), never the provider identifier itself.
    invoice: invoice
      ? {
          ...(({ stripeInvoiceId: _stripeInvoiceId, saleKind: _saleKind, ...rest }) => rest)(invoice),
          balanceCents: Math.max(0, invoice.amountDueCents - invoice.amountPaidCents),
          isLocalInvoice: invoice.stripeInvoiceId === null,
          isShopSale: invoice.saleKind === "SHOP_SALE",
        }
      : null,
    // What the customer still owes on the first open bill (never below
    // zero); pages format this, they never subtract in page code.
    balanceCents: invoice
      ? Math.max(0, invoice.amountDueCents - invoice.amountPaidCents)
      : 0,
    // Rentals waiting for this customer's signature, oldest first; the
    // sign-in link uses the signature record's id (the /sign/[id] route).
    signingWaiting: awaitingSignature.flatMap((agreement) =>
      agreement.signature
        ? [{ agreementId: agreement.id, signHref: `/sign/${agreement.signature.id}` }]
        : [],
    ),
    openRequestCount,
    openVisits,
    nextBills,
  };
}
