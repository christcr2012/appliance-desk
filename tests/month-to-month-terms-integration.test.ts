import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateBusinessSettings } from "@/domains/settings";
import { effectiveMonthToMonthTerms, termsChangeKey } from "@/domains/agreements/month-to-month";
import { signAgreement } from "@/domains/agreements";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const DAY = 86_400_000;

describe.skipIf(!enabled)("month-to-month terms versions and the change notice", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `mtt-owner-${tag}`;
  const userId = `mtt-user-${tag}`;
  const customerId = `mtt-customer-${tag}`;
  const addressId = `mtt-address-${tag}`;
  const ids: string[] = [];
  let versionsBefore: number[] = [];
  let settingsBefore: { earlyTerminationNoticeDays: number | null; terminationTermsText: string | null } | null = null;

  async function agreement(data: { termMonths: number | null; status?: "ACTIVE" | "AWAITING_SIGNATURE"; version?: number | null }) {
    const created = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: data.status ?? "ACTIVE",
        termMonths: data.termMonths,
        startDate: new Date("2027-02-08T07:00:00Z"),
        nextBillingDate: new Date("2027-03-08T07:00:00Z"),
        monthToMonthTermsVersion: data.version ?? null,
        lines: { create: [{ label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 }] },
      },
    });
    ids.push(created.id);
    return created;
  }
  const publish = (days: number, text: string) =>
    updateBusinessSettings(ownerId, { earlyTerminationNoticeDays: days, terminationTermsText: text });
  const newestVersion = async () => (await prisma.monthToMonthTermsVersion.findFirstOrThrow({ orderBy: { version: "desc" } })).version;

  beforeAll(async () => {
    versionsBefore = (await prisma.monthToMonthTermsVersion.findMany({ select: { version: true } })).map((v) => v.version);
    settingsBefore = await prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { earlyTerminationNoticeDays: true, terminationTermsText: true },
    });
    await prisma.user.create({ data: { id: ownerId, email: `${tag}-o@example.test`, name: "Owner", role: "OWNER", emailVerified: true } });
    await prisma.user.create({ data: { id: userId, email: `${tag}-c@example.test`, name: "Terms Customer", role: "CUSTOMER", emailVerified: true } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `T${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } });
  });

  afterAll(async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: {
        earlyTerminationNoticeDays: settingsBefore?.earlyTerminationNoticeDays ?? null,
        terminationTermsText: settingsBefore?.terminationTermsText ?? null,
      },
    });
    const created = await prisma.monthToMonthTermsVersion.findMany({ where: { version: { notIn: versionsBefore } }, select: { version: true } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ userId: ownerId }, { entityId: { in: [...ids, ...created.map((v) => String(v.version))] } }] },
    });
    await prisma.customerNotice.deleteMany({ where: { customerId } });
    await prisma.signatureRecord.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
    await prisma.monthToMonthTermsVersion.deleteMany({ where: { version: { in: created.map((v) => v.version) } } });
  });

  it("mtm-terms-change-creates-one-notice-per-monthly-rental-none-for-fixed", async () => {
    const monthly = await agreement({ termMonths: null });
    const fixed = await agreement({ termMonths: 12 });
    await publish(41, `Terms ${tag} first`);
    const v = await newestVersion();
    const notice = await prisma.customerNotice.findUnique({ where: { dedupeKey: termsChangeKey(v, monthly.id) } });
    expect(notice?.kind).toBe("TERMS_CHANGE");
    expect(notice?.status).toBe("PENDING");
    expect(notice?.earliestAt).toBeNull();
    expect(notice?.deadlineAt).toBeNull();
    expect(notice?.body).toContain(`Terms ${tag} first`);
    expect(await prisma.customerNotice.count({ where: { agreementId: fixed.id } })).toBe(0);

    // Saving the same terms again publishes nothing new.
    await publish(41, `Terms ${tag} first`);
    expect(await newestVersion()).toBe(v);
    expect(await prisma.customerNotice.count({ where: { agreementId: monthly.id, kind: "TERMS_CHANGE" } })).toBe(1);

    // A later change withdraws the unsent earlier notice and makes a new one.
    await publish(45, `Terms ${tag} second`);
    expect((await prisma.customerNotice.findUnique({ where: { dedupeKey: termsChangeKey(v, monthly.id) } }))?.status).toBe("NOT_NEEDED");
    expect((await prisma.customerNotice.findUnique({ where: { dedupeKey: termsChangeKey(v + 1, monthly.id) } }))?.status).toBe("PENDING");
  });

  it("mtm-terms-apply-only-30-days-after-delivery and an undelivered customer stays on the old version", async () => {
    const base = await newestVersion();
    const a = await agreement({ termMonths: null, version: base });
    await publish(50, `Terms ${tag} third`);
    const v = await newestVersion();
    expect(v).toBe(base + 1);
    const key = termsChangeKey(v, a.id);

    // Never delivered: still on the old terms, however long ago.
    const farFuture = new Date("2030-01-01T12:00:00Z");
    expect((await effectiveMonthToMonthTerms(prisma, a.id, farFuture))?.version).toBe(base);

    const delivered = new Date("2027-05-01T18:00:00Z");
    await prisma.customerNotice.update({ where: { dedupeKey: key }, data: { status: "SENT", sentAt: delivered, evidenceDate: delivered } });
    expect((await effectiveMonthToMonthTerms(prisma, a.id, new Date(delivered.getTime() + 29 * DAY)))?.version).toBe(base);
    const after = await effectiveMonthToMonthTerms(prisma, a.id, new Date(delivered.getTime() + 30 * DAY));
    expect(after?.version).toBe(v);
    expect(after?.noticeDays).toBe(50);
  });

  it("mtm-terms-new-rental-starts-on-newest-version", async () => {
    const created = await agreement({ termMonths: null, status: "AWAITING_SIGNATURE" });
    const signature = await prisma.signatureRecord.create({ data: { agreementId: created.id, provider: "test" } });
    await signAgreement(signature.id, { signerName: "Terms Customer", signerEmail: `${tag}-c@example.test`, ipAddress: null });
    const signed = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: created.id } });
    expect(signed.status).toBe("ACTIVE");
    expect(signed.monthToMonthTermsVersion).toBe(await newestVersion());
  });
});
