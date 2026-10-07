import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { cancelAtSecondsFor } from "@/domains/billing/subscription-term";
import { seedTaxReadyContext } from "./tax-ready";

/** A throwaway customer with active 12-month, auto-renew agreements, for the real-Postgres notice tests. */
export const termEnd = new Date("2027-11-08T06:59:59Z");
export const renewalStart = new Date("2027-11-08T07:00:00Z");
export const windowOpen = new Date("2027-10-20T12:00:00Z");
/** 27 days before the renewal starts: inside the 25 to 40 day reminder window. */
export const inReminderWindow = new Date("2027-10-12T18:00:00Z");

const snapshot = {
  shape: 1,
  source: "SYSTEM",
  capturedAt: "2026-11-01T00:00:00Z",
  termination: null,
  autoRenew: { noticeDays: 30, termsText: "Renews month to month.", termsVersion: "ar-test" },
};

export function createNoticeFixture(stripeState: Map<string, number | null>) {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `nf-user-${tag}`;
  const customerId = `nf-customer-${tag}`;
  const addressId = `nf-address-${tag}`;
  const ids: string[] = [];
  const extraUserIds: string[] = [];
  let taxReady: Awaited<ReturnType<typeof seedTaxReadyContext>> | null = null;

  async function setup() {
    await prisma.user.create({
      data: { id: userId, email: `${tag}-c@example.test`, name: "NF Customer", role: "CUSTOMER", emailVerified: true },
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `N${tag.slice(0, 18)}`, smsOptInAt: null } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } });
    taxReady = await seedTaxReadyContext(addressId);
  }

  async function agreement(options: { endDate?: Date } = {}) {
    const n = ids.length;
    const endDate = options.endDate ?? termEnd;
    const created = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        termMonths: 12,
        startDate: options.endDate ? new Date(endDate.getTime() - 365 * 86_400_000) : new Date("2026-11-08T07:00:00Z"),
        endDate,
        stripeSubscriptionId: `sub_${tag}_${n}`,
        renewalPreference: "AUTO_RENEW",
        autoRenewConsentedAt: new Date("2026-11-08T08:00:00Z"),
        autoRenewTermsVersion: "ar-test",
        termsSnapshot: snapshot,
        lines: {
          create: [
            { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 },
            { label: "Dryer", monthlyPriceCents: 3000, listPriceCents: 3000 },
          ],
        },
      },
    });
    ids.push(created.id);
    stripeState.set(created.stripeSubscriptionId!, cancelAtSecondsFor(created));
    return created;
  }

  async function user(role: "OWNER" | "ADMIN" | "STAFF") {
    const id = `nf-${role.toLowerCase()}-${randomUUID().slice(0, 8)}-${tag}`;
    await prisma.user.create({ data: { id, email: `${id}@example.test`, name: role, role, emailVerified: true } });
    extraUserIds.push(id);
    return id;
  }

  const noticeOf = (a: { id: string }) =>
    prisma.customerNotice.findFirstOrThrow({ where: { agreementId: a.id, kind: "RENEWAL_REMINDER" } });

  async function cleanup() {
    const renewals = await prisma.rentalAgreement.findMany({ where: { renewedFromAgreementId: { in: ids } }, select: { id: true } });
    const all = [...ids, ...renewals.map((r) => r.id)];
    const jobs = await prisma.job.findMany({ where: { OR: [{ agreementId: { in: all } }, { customerId }] }, select: { id: true } });
    const invoices = await prisma.invoice.findMany({ where: { agreementId: { in: all } }, select: { id: true } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityId: { in: [...all, ...jobs.map((j) => j.id), ...invoices.map((i) => i.id)] } },
          { userId: { in: extraUserIds } },
          { entityType: "CustomerNotice", entityId: { in: (await prisma.customerNotice.findMany({ where: { customerId }, select: { id: true } })).map((x) => x.id) } },
        ],
      },
    });
    await prisma.providerOperation.deleteMany({ where: { subjectId: { in: all } } });
    await prisma.subscriptionEndIntent.deleteMany({ where: { holderAgreementId: { in: all } } });
    await prisma.job.deleteMany({ where: { id: { in: jobs.map((j) => j.id) } } });
    await prisma.staffTask.deleteMany({ where: { customerId } });
    await prisma.signatureRecord.deleteMany({ where: { agreementId: { in: all } } });
    await prisma.invoice.deleteMany({ where: { agreementId: { in: all } } });
    await prisma.customerNotice.updateMany({ where: { customerId }, data: { sentByUserId: null, resolvedByUserId: null } });
    await prisma.customerNotice.deleteMany({ where: { customerId } });
    await prisma.consentRecord.deleteMany({ where: { customerId } });
    await prisma.applianceAssignment.deleteMany({ where: { rentalLine: { agreementId: { in: all } } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: all } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: renewals.map((r) => r.id) } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    await taxReady?.cleanup();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, ...extraUserIds] } } });
  }

  return { tag, userId, customerId, addressId, ids, setup, agreement, user, noticeOf, cleanup };
}
