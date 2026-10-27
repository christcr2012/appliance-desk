import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { checkupDue, profileGaps, PROFILE_FIELDS, type ProfileKey } from "./rules";

/** Counts only (no customer names): the "If I'm gone" page is read by whoever the owner trusts, so it stays high-level. */
export async function loadContinuity(now: Date) {
  const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const [settings, appliancesOut, activeAgreements, openBalance, upcomingJobs, nextJobs, checkups] = await Promise.all([
    prisma.businessSettings.upsert({
      where: { id: "singleton" }, create: { id: "singleton" }, update: {},
      select: {
        continuityEmergencyName: true, continuityEmergencyContact: true, continuitySuccessorName: true, continuitySuccessorContact: true,
        continuityCpaName: true, continuityCpaContact: true, continuityAttorneyName: true, continuityAttorneyContact: true, continuityRecordsNote: true,
        continuityReviewedAt: true, chargesPausedAt: true, chargesPausedNote: true,
      },
    }),
    prisma.appliance.count({ where: { status: { in: ["RENTED", "AWAITING_PICKUP"] } } }),
    prisma.rentalAgreement.count({ where: { status: "ACTIVE" } }),
    prisma.invoice.aggregate({
      where: { status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT", "FAILED"] } },
      _sum: { amountDueCents: true, amountPaidCents: true }, _count: true,
    }),
    prisma.job.count({ where: { status: "SCHEDULED", scheduledAt: { gte: now, lt: horizon } } }),
    prisma.job.findMany({ where: { status: "SCHEDULED", scheduledAt: { gte: now, lt: horizon } }, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], take: 10, select: { id: true, type: true, scheduledAt: true } }),
    prisma.yearlyCheckup.findMany({ select: { year: true, completedAt: true }, orderBy: { year: "desc" }, take: 10 }),
  ]);
  const profile = Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, settings[f.key as ProfileKey]])) as Record<ProfileKey, string | null>;
  const due = checkupDue(now, checkups.map((c) => c.year));
  return {
    profile,
    gaps: profileGaps(profile),
    reviewedAt: settings.continuityReviewedAt,
    paused: settings.chargesPausedAt ? { since: settings.chargesPausedAt, note: settings.chargesPausedNote } : null,
    live: {
      appliancesOut,
      activeAgreements,
      openInvoiceCount: openBalance._count,
      openBalanceCents: Math.max(0, (openBalance._sum.amountDueCents ?? 0) - (openBalance._sum.amountPaidCents ?? 0)),
      upcomingJobs,
      nextJobs: nextJobs.map((j) => ({ id: j.id, type: j.type, when: j.scheduledAt! })),
    },
    checkups,
    checkupDue: due,
    todayKey: businessDateKey(now),
  };
}
