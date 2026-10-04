import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getAgreementsPage } from "@/domains/agreements";
import { getJobById } from "@/domains/jobs";
import type { RentalAgreementStatus } from "@prisma/client";

const customerName = { user: { select: { name: true, email: true } } } as const;
const address = {
  line1: true,
  line2: true,
  city: true,
  state: true,
  zip: true,
} as const;

/** Common list DTO: STAFF never queries prices; owners retain their totals. */
export async function getDeskAgreementsPage(
  filter: { status?: RentalAgreementStatus } | undefined,
  skip: number,
  take: number,
) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  if (session.user.role === "OWNER" || session.user.role === "ADMIN") {
    const rows = await getAgreementsPage(filter, skip, take);
    return rows.map(
      ({
        id,
        status,
        reservationExpiresAt,
        customer,
        serviceAddress,
        lines,
      }) => ({
        id,
        status,
        reservationExpiresAt,
        customer,
        serviceAddress,
        applianceCount: lines.length,
        monthlyCents: lines.reduce(
          (sum, line) => sum + line.monthlyPriceCents,
          0,
        ),
      }),
    );
  }
  const rows = await prisma.rentalAgreement.findMany({
    where: filter?.status ? { status: filter.status } : undefined,
    select: {
      id: true,
      status: true,
      reservationExpiresAt: true,
      customer: { select: customerName },
      serviceAddress: { select: address },
      _count: { select: { lines: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    skip,
    take,
  });
  return rows.map(({ _count, ...row }) => ({
    ...row,
    applianceCount: _count.lines,
    monthlyCents: null,
  }));
}

export async function getOperationalAgreementById(id: string) {
  await requireRole("OWNER", "ADMIN", "STAFF");
  return prisma.rentalAgreement.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      customer: { select: customerName },
      serviceAddress: { select: address },
      lines: {
        select: {
          id: true,
          assignments: {
            where: { unassignedAt: null },
            select: {
              appliance: {
                select: {
                  id: true,
                  assetNumber: true,
                  applianceType: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

/** The incoming unit(s) of a swap, read from the job's own appliance roles. Display only: it is not a permission. */
async function swapReplacementIdsFor(job: { id: string; type: string }) {
  if (job.type !== "SWAP") return [];
  const rows = await prisma.jobAppliance.findMany({ where: { jobId: job.id, role: "REPLACEMENT" }, select: { applianceId: true }, orderBy: { applianceId: "asc" } });
  return rows.map((row) => row.applianceId);
}

/** STAFF's client-component payload contains no costs or full agreement. */
export async function getDeskJobById(id: string) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  if (session.user.role === "OWNER" || session.user.role === "ADMIN") {
    const job = await getJobById(id);
    return job ? { ...job, swapReplacementIds: await swapReplacementIdsFor(job), canViewFinance: true as const } : null;
  }
  const job = await prisma.job.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      status: true,
      scheduledAt: true,
      durationMinutes: true,
      assignedToUserId: true,
      version: true,
      noShowAt: true,
      completionNotes: true,
      checklist: true,
      agreementId: true,
      customer: { select: customerName },
      serviceAddress: { select: address },
      maintenanceRequest: { select: { id: true } },
      outcome: true,
      appliances: {
        select: {
          result: true,
          role: true,
          appliance: {
            select: {
              id: true,
              assetNumber: true,
              status: true,
              applianceType: { select: { name: true } },
            },
          },
        },
      },
      photos: {
        orderBy: [{ createdAt: "desc" }],
        select: { id: true, url: true, altText: true },
      },
    },
  });
  return job ? { ...job, swapReplacementIds: await swapReplacementIdsFor(job), canViewFinance: false as const } : null;
}

export async function getOperationalApplianceById(id: string) {
  await requireRole("OWNER", "ADMIN", "STAFF");
  return prisma.appliance.findUnique({
    where: { id },
    select: {
      id: true,
      assetNumber: true,
      status: true,
      manufacturer: true,
      model: true,
      serialNumber: true,
      color: true,
      condition: true,
      currentLocation: true,
      notes: true,
      applianceType: { select: { name: true } },
      photos: {
        orderBy: [{ createdAt: "asc" }],
        select: { id: true, url: true, altText: true },
      },
    },
  });
}
