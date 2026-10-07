import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const refundCreate = vi.hoisted(() => vi.fn(async () => ({ id: "re_test", status: "succeeded" })));
vi.mock("@/lib/session", () => ({ requireRole: vi.fn(async () => ({ user: { role: "OWNER" } })) }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({ refunds: { create: refundCreate } }) }));

import { prisma } from "@/lib/prisma";
import { completeJob } from "@/domains/jobs";
import { businessDateFromKey } from "@/lib/business-date";
import { openCustodyEpisodeInTx } from "@/domains/inventory/custody";
import {
  applyEarlyReturn,
  choiceFromSettings,
  parsePreview,
  previewEarlyReturn,
  serializePreview,
  type EarlyReturnChoice,
} from "@/domains/agreements/early-return";
import { choiceFromFields, fieldsFromChoice } from "@/domains/agreements/early-return-form";
import { earlyReturnSettingsFrom, earlyReturnUpdate, RECOMMENDED_EARLY_RETURN } from "@/domains/settings/early-return";
import { removeUndeliveredItem } from "@/domains/billing/pickup-billing-events";
import { returnedEarlyRows } from "@/domains/exceptions";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe("early-return settings and choices (pure)", () => {
  it("falls back to the recommended values for anything unknown", () => {
    expect(earlyReturnSettingsFrom(null)).toEqual(RECOMMENDED_EARLY_RETURN);
    expect(earlyReturnSettingsFrom({ earlyReturnBilling: "NONSENSE", earlyReturnFee: "NO_FEE" })).toEqual({ ...RECOMMENDED_EARLY_RETURN, fee: "NO_FEE" });
  });
  it("saves only valid choices", () => {
    const good = { billing: "END_AT_PICKUP", unusedDays: "CREDIT", fee: "NO_FEE", handling: "APPLY_DEFAULTS", prorationBasis: "ACTUAL_DAYS_IN_MONTH" };
    const ok = earlyReturnUpdate(good);
    expect(ok.success && ok.update.earlyReturnUnusedDays).toBe("CREDIT");
    expect(earlyReturnUpdate({ ...good, billing: "SOON" }).success).toBe(false);
    expect(earlyReturnUpdate({ billing: "END_AT_PICKUP" }).success).toBe(false);
  });
  it("reads the form text back into a choice and round-trips a preview", () => {
    const fallback = choiceFromSettings(RECOMMENDED_EARLY_RETURN);
    expect(fallback).toEqual({ billing: "KEEP_TO_AGREED_END", unusedDays: "KEEP", feeCents: "AGREED_TERMS" });
    const custom = choiceFromFields({ billing: "END_AT_PICKUP", unusedDays: "REFUND", fee: "CUSTOM", feeDollars: "25.5", feeReason: " Goodwill " }, fallback);
    expect(custom).toEqual({ billing: "END_AT_PICKUP", unusedDays: "REFUND", feeCents: 2550, feeReason: "Goodwill" });
    expect(fieldsFromChoice(custom).feeDollars).toBe("25.50");
    expect(() => choiceFromFields({ fee: "CUSTOM", feeDollars: "abc" }, fallback)).toThrow(/dollars and cents/);
    const preview = {
      agreedEndOn: new Date("2027-10-01T05:59:59Z"),
      lastBilledDay: new Date("2026-09-19T12:00:00Z"),
      unusedDaysCount: 11,
      unusedCents: 1100,
      unusedTaxCents: 77,
      quotedFeeCents: 5000,
      feeCents: 5000,
      refundOrCreditCents: 0,
      prepaidNeedsOwner: false,
    };
    expect(parsePreview(serializePreview(preview))).toEqual(preview);
    expect(() => parsePreview("{}")).toThrow();
  });
});

describe.skipIf(!enabled)("early returns (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `er-owner-${tag}`;
  const userId = `er-user-${tag}`;
  const customerId = `er-customer-${tag}`;
  const addressId = `er-address-${tag}`;
  const typeId = `er-type-${tag}`;
  const mtmVersion = 900_000 + (Number.parseInt(tag.slice(0, 5), 16) % 90_000);
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  const endOfSep2027 = new Date("2027-10-01T05:59:59Z");
  const policy = { feeCents: 5000, feePercent: null, feeCapCents: null, noticeDays: 30, unusedTerm: "RETAIN", termsText: "Early ending terms for the test." };
  let original: Record<string, unknown> | null = null;
  let taxReady: Awaited<ReturnType<typeof seedTaxReadyContext>> | null = null;

  async function settings(partial: { billing?: string; unused?: string; fee?: string; handling?: string; basis?: string; pickupDayNotBilled?: boolean } = {}) {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: {
        earlyReturnBilling: partial.billing ?? "KEEP_TO_AGREED_END",
        earlyReturnUnusedDays: partial.unused ?? "KEEP",
        earlyReturnFee: partial.fee ?? "AGREED_TERMS_FEE",
        earlyReturnHandling: partial.handling ?? "ASK_ME",
        earlyReturnProrationBasis: partial.basis ?? "MONTHLY_DIV_30",
        pickupDayNotBilled: partial.pickupDayNotBilled ?? true,
      },
    });
  }

  async function rental(opts: { fixed?: boolean; prepaid?: boolean; units?: number } = {}) {
    const fixed = opts.fixed ?? true;
    const agreementId = `er-ag-${agreementIds.length}-${tag}`;
    agreementIds.push(agreementId);
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        termMonths: fixed ? 24 : null,
        endDate: fixed ? endOfSep2027 : null,
        paidInFullInAdvance: opts.prepaid ?? false,
        billingStartedAt: new Date("2025-10-01T06:00:00Z"),
        nextBillingDate: new Date("2026-10-01T06:00:00Z"),
        taxRateMilliPercent: 7000,
        firstDeliveredOn: new Date("2025-10-01T06:00:00Z"),
        termsSnapshot: fixed ? { shape: 1, source: "SYSTEM", capturedAt: "2025-10-01T00:00:00Z", termination: policy, autoRenew: null } : undefined,
        monthToMonthTermsVersion: fixed ? null : mtmVersion,
        lines: { create: { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 } },
      },
    });
    const line = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } });
    const setupId = `er-setup-${jobIds.length}-${tag}`;
    jobIds.push(setupId);
    await prisma.job.create({ data: { id: setupId, type: "DELIVERY", status: "COMPLETED", customerId, serviceAddressId: addressId, agreementId } });
    const units: string[] = [];
    for (let i = 0; i < (opts.units ?? 1); i += 1) {
      const id = `er-unit-${applianceIds.length}-${tag}`;
      applianceIds.push(id);
      await prisma.appliance.create({ data: { id, assetNumber: `ER${applianceIds.length}-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "RENTED" } });
      await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: id } });
      await prisma.$transaction((tx) =>
        openCustodyEpisodeInTx(tx, { applianceId: id, customerId, serviceAddressId: addressId, agreementId, startedOn: new Date("2025-10-01T06:00:00Z"), startJobId: setupId }),
      );
      units.push(id);
    }
    return { agreementId, units };
  }

  async function pickup(agreementId: string, units: string[], on: string) {
    const id = `er-job-${jobIds.length}-${tag}`;
    jobIds.push(id);
    await prisma.job.create({
      data: { id, type: "REMOVAL", status: "IN_PROGRESS", customerId, serviceAddressId: addressId, agreementId, appliances: { create: units.map((applianceId) => ({ applianceId })) } },
    });
    await completeJob(ownerId, {
      jobId: id,
      expectedVersion: 1,
      completionKey: `er-key-${randomUUID()}`,
      performedOn: businessDateFromKey(on),
      completionNotes: null,
      results: units.map((applianceId) => ({ applianceId, result: "RETURNED" as const })),
    });
    return id;
  }

  /** An invoice for one billing month, paid (fully or in part) by Stripe or by hand. */
  async function paidInvoice(agreementId: string, periodStart: string, paidCents: number, via: "STRIPE" | "MANUAL") {
    const invoice = await prisma.invoice.create({
      data: {
        customerId,
        agreementId,
        status: paidCents >= 3210 ? "PAID" : "PARTIALLY_PAID",
        subtotalCents: 3000,
        taxCents: 210,
        amountDueCents: 3210,
        amountPaidCents: paidCents,
        billingPeriodStart: businessDateFromKey(periodStart),
        dueDate: businessDateFromKey(periodStart),
        lineItems: { create: { kind: "RENTAL", description: "Washer", amountCents: 3000, quantity: 1 } },
      },
    });
    const charge = via === "STRIPE" ? `ch_${randomUUID().replaceAll("-", "")}` : null;
    const receipt = await prisma.receipt.create({
      data: { customerId, source: via, amountCents: paidCents, method: via === "STRIPE" ? "card" : "check", stripeChargeId: charge, receivedOn: businessDateFromKey(periodStart)! },
    });
    await prisma.payment.create({
      data: { invoiceId: invoice.id, amountCents: paidCents, status: "succeeded", receiptId: receipt.id, stripeChargeId: charge, method: via === "STRIPE" ? "card" : "check" },
    });
    return invoice.id;
  }

  const agreementOf = (id: string) => prisma.rentalAgreement.findUniqueOrThrow({ where: { id } });
  const resolutionOf = (id: string) => prisma.earlyReturnResolution.findUnique({ where: { agreementId: id } });
  const standard = (): EarlyReturnChoice => choiceFromSettings(RECOMMENDED_EARLY_RETURN);
  async function settle(agreementId: string, choice: EarlyReturnChoice) {
    const preview = await previewEarlyReturn(agreementId, choice);
    await applyEarlyReturn(ownerId, agreementId, choice, preview);
    return preview;
  }

  beforeAll(async () => {
    original = await prisma.businessSettings.findUnique({ where: { id: "singleton" } });
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "ER Owner", role: "OWNER", emailVerified: true },
        { id: userId, email: `${tag}-c@example.test`, name: "ER Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `E${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } });
    taxReady = await seedTaxReadyContext(addressId, { rateMilliPercent: 7000 });
    await prisma.applianceType.create({ data: { id: typeId, name: `ER ${tag}`, slug: `er-${tag}` } });
    await prisma.monthToMonthTermsVersion.create({
      data: { id: `er-mtm-${tag}`, version: mtmVersion, noticeDays: 30, termsText: "Thirty days' notice to end.", publishedAt: new Date("2025-01-01T00:00:00Z") },
    });
  });

  afterAll(async () => {
    const invoices = (await prisma.invoice.findMany({ where: { customerId }, select: { id: true } })).map((i) => i.id);
    const refunds = (await prisma.refund.findMany({ where: { invoiceId: { in: invoices } }, select: { id: true } })).map((r) => r.id);
    await prisma.providerOperation.deleteMany({ where: { subjectType: "Refund", subjectId: { in: refunds } } });
    await prisma.refund.deleteMany({ where: { id: { in: refunds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoices } } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.earlyReturnResolution.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.pendingDelivery.deleteMany({ where: { agreementId: { in: agreementIds } } });
    const lineIds = (await prisma.rentalLine.findMany({ where: { agreementId: { in: agreementIds } }, select: { id: true } })).map((l) => l.id);
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "RentalLineAmendment" DISABLE TRIGGER "RentalLineAmendment_append_only"'),
      prisma.rentalLineAmendment.deleteMany({ where: { rentalLineId: { in: lineIds } } }),
      prisma.$executeRawUnsafe('ALTER TABLE "RentalLineAmendment" ENABLE TRIGGER "RentalLineAmendment_append_only"'),
    ]);
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoices } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoices } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ userId: ownerId }, { entityId: { in: [...invoices, ...agreementIds, ...jobIds, ...applianceIds] } }] },
    });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.monthToMonthTermsVersion.deleteMany({ where: { version: mtmVersion } });
    await taxReady?.cleanup();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
    if (original) {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: {
          earlyReturnBilling: original.earlyReturnBilling as string,
          earlyReturnUnusedDays: original.earlyReturnUnusedDays as string,
          earlyReturnFee: original.earlyReturnFee as string,
          earlyReturnHandling: original.earlyReturnHandling as string,
          earlyReturnProrationBasis: original.earlyReturnProrationBasis as string,
          pickupDayNotBilled: original.pickupDayNotBilled as boolean,
        },
      });
    }
  });

  it("keep-billing-fixed-term-records-agreed-terms-ending-with-quote-fee", async () => {
    await settings();
    const { agreementId, units } = await rental();
    await pickup(agreementId, units, "2026-09-20");
    expect((await agreementOf(agreementId)).status).toBe("ACTIVE"); // billing carries on until the owner chooses
    const preview = await settle(agreementId, standard());
    expect(preview.quotedFeeCents).toBe(5000);
    const after = await agreementOf(agreementId);
    expect(after.status).toBe("ACTIVE");
    expect(after.terminationEffectiveOn?.toISOString()).toBe("2026-11-01T06:00:00.000Z"); // 30 days' notice from Sep 20 → the Nov 1 billing date
    expect(after.terminationFeeCents).toBe(5000);
    expect(after.terminationRequestedAt?.toISOString()).toBe("2026-09-20T06:00:00.000Z");
    const resolution = await resolutionOf(agreementId);
    expect([resolution?.billing, resolution?.appliedBy, resolution?.feeCents]).toEqual(["KEEP_TO_AGREED_END", "OWNER", 5000]);
    expect(await prisma.invoice.count({ where: { agreementId } })).toBe(0); // the fee invoice is made on the ending date, never now
    await expect(settle(agreementId, standard())).rejects.toThrow(/already settled/);
  });

  it("keep-billing-month-to-month-records-notice-ending-no-fee", async () => {
    await settings();
    const { agreementId, units } = await rental({ fixed: false });
    await pickup(agreementId, units, "2026-09-20");
    const preview = await settle(agreementId, standard());
    expect(preview.feeCents).toBe(0);
    const after = await agreementOf(agreementId);
    expect(after.status).toBe("ACTIVE");
    expect(after.terminationEffectiveOn?.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(after.terminationFeeCents).toBe(0);
    expect(after.terminationPolicyVersion).toBe(`mtm-v${mtmVersion}`);
  });

  it("end-at-pickup-fixed-term-fee-invoice-open-not-charged", async () => {
    await settings();
    const { agreementId, units } = await rental();
    await pickup(agreementId, units, "2026-09-20");
    const preview = await settle(agreementId, { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: "AGREED_TERMS" });
    expect(preview.lastBilledDay.toISOString().slice(0, 10)).toBe("2026-09-19"); // the pickup day is not billed
    expect([preview.unusedDaysCount, preview.unusedCents, preview.unusedTaxCents]).toEqual([11, 1100, 77]);
    const after = await agreementOf(agreementId);
    expect(after.status).toBe("ENDED");
    expect(after.endDate?.toISOString()).toBe("2026-09-20T05:59:59.000Z");
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { agreementId }, include: { lineItems: true, payments: true } });
    expect(invoice.status).toBe("OPEN");
    expect(invoice.amountDueCents).toBe(5350);
    expect(invoice.payments).toHaveLength(0);
    expect(invoice.lineItems.map((l) => [l.kind, l.amountCents])).toEqual([
      ["EARLY_TERMINATION_FEE", 5000],
      ["TAX", 350],
    ]);
    expect((await resolutionOf(agreementId))?.feeInvoiceId).toBe(invoice.id);
    expect(await prisma.customerCredit.count({ where: { customerId, sourceType: "EARLY_RETURN", sourceId: (await resolutionOf(agreementId))!.id } })).toBe(0);
  });

  it("end-at-pickup-refund-splits-stripe-and-by-hand", async () => {
    await settings();
    refundCreate.mockClear();
    const { agreementId, units } = await rental();
    await paidInvoice(agreementId, "2026-08-01", 3210, "MANUAL");
    const stripeInvoice = await paidInvoice(agreementId, "2026-09-01", 500, "STRIPE");
    await pickup(agreementId, units, "2026-09-20");
    await settle(agreementId, { billing: "END_AT_PICKUP", unusedDays: "REFUND", feeCents: 0 });
    const resolution = await resolutionOf(agreementId);
    expect([resolution?.refundedCents, resolution?.refundByHandCents]).toEqual([500, 677]); // 1,177 owed back: newest paid bill first
    const refunds = await prisma.refund.findMany({ where: { invoice: { agreementId } }, orderBy: { amountCents: "asc" } });
    expect(refunds.map((r) => r.amountCents)).toEqual([500, 677]);
    expect(refunds.find((r) => r.invoiceId === stripeInvoice)?.stripeRefundId).toBe("re_test");
    expect(refundCreate).toHaveBeenCalledTimes(1);
    expect(await prisma.customerCredit.count({ where: { customerId, sourceType: "EARLY_RETURN" } })).toBe(0);
  });

  it("end-at-pickup-credit-creates-account-credit", async () => {
    await settings();
    const { agreementId, units } = await rental();
    await pickup(agreementId, units, "2026-09-20");
    await settle(agreementId, { billing: "END_AT_PICKUP", unusedDays: "CREDIT", feeCents: 0 });
    const resolution = (await resolutionOf(agreementId))!;
    const credit = await prisma.customerCredit.findFirstOrThrow({ where: { customerId, sourceType: "EARLY_RETURN", sourceId: resolution.id } });
    expect([credit.amountCents, credit.remainingCents]).toEqual([1177, 1177]);
    expect(resolution.creditId).toBe(credit.id);
    expect(await prisma.refund.count({ where: { invoice: { agreementId } } })).toBe(0);
    expect(await prisma.invoice.count({ where: { agreementId } })).toBe(0); // no fee asked for
  });

  it("end-at-pickup-keep-no-money", async () => {
    await settings();
    const { agreementId, units } = await rental({ fixed: false });
    await pickup(agreementId, units, "2026-09-20");
    const preview = await settle(agreementId, { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: "AGREED_TERMS" });
    expect([preview.feeCents, preview.refundOrCreditCents]).toEqual([0, 0]); // month-to-month never has a fee
    expect((await agreementOf(agreementId)).status).toBe("ENDED");
    expect(await prisma.invoice.count({ where: { agreementId } })).toBe(0);
    expect(await prisma.customerCredit.count({ where: { customerId, sourceId: (await resolutionOf(agreementId))!.id } })).toBe(0);
    await expect(
      previewEarlyReturn(agreementId, { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: 500, feeReason: "A fee I would like" }),
    ).rejects.toThrow(); // already settled rental or month-to-month fee: either way never accepted
  });

  it("custom-fee-needs-reason, and fee-above-quote-needs-reason", async () => {
    await settings();
    const a = await rental();
    await pickup(a.agreementId, a.units, "2026-09-20");
    await expect(previewEarlyReturn(a.agreementId, { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: 2500 })).rejects.toThrow(/written reason/);
    await expect(previewEarlyReturn(a.agreementId, { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: 9000 })).rejects.toThrow(/above the rental's agreed fee needs a written reason/);
    await expect(previewEarlyReturn(a.agreementId, { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: 9000, feeReason: "no" })).rejects.toThrow(/written reason/);
    await settle(a.agreementId, { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: 2500, feeReason: "Customer was a long-time friend" });
    const resolution = await resolutionOf(a.agreementId);
    expect([resolution?.feeCents, resolution?.feeReason]).toEqual([2500, "Customer was a long-time friend"]);

    const b = await rental();
    await pickup(b.agreementId, b.units, "2026-09-20");
    await settle(b.agreementId, { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: 9000, feeReason: "Special delivery costs we had to cover" });
    expect((await prisma.invoice.findFirstOrThrow({ where: { agreementId: b.agreementId } })).amountDueCents).toBe(9000);
  });

  it("prepaid-refused", async () => {
    await settings({ handling: "APPLY_DEFAULTS", billing: "END_AT_PICKUP" });
    const { agreementId, units } = await rental({ prepaid: true });
    await pickup(agreementId, units, "2026-09-20");
    expect(await resolutionOf(agreementId)).toBeNull(); // the defaults never apply to a prepaid rental
    expect((await agreementOf(agreementId)).status).toBe("ACTIVE");
    const preview = await previewEarlyReturn(agreementId, standard());
    expect(preview.prepaidNeedsOwner).toBe(true);
    await expect(applyEarlyReturn(ownerId, agreementId, standard(), preview)).rejects.toThrow(/paid in advance/);
  });

  it("apply-defaults-on-pickup-completion", async () => {
    await settings({ handling: "APPLY_DEFAULTS", billing: "END_AT_PICKUP", unused: "CREDIT" });
    const { agreementId, units } = await rental();
    const job = await pickup(agreementId, units, "2026-09-20");
    const after = await agreementOf(agreementId);
    expect(after.status).toBe("ENDED");
    const resolution = (await resolutionOf(agreementId))!;
    expect([resolution.appliedBy, resolution.jobId, resolution.feeCents]).toEqual(["DEFAULTS", job, 5000]);
    expect((await prisma.customerCredit.findFirstOrThrow({ where: { sourceId: resolution.id } })).amountCents).toBe(1177);
    expect((await prisma.invoice.findFirstOrThrow({ where: { agreementId } })).amountDueCents).toBe(5000);
    expect(await prisma.staffTask.count({ where: { sourceKey: `job:${job}:returned-early` } })).toBe(0);
  });

  it("ask-me-creates-one-task-and-today-item", async () => {
    await settings({ handling: "ASK_ME" });
    const { agreementId, units } = await rental();
    const job = await pickup(agreementId, units, "2026-09-20");
    expect(await prisma.staffTask.count({ where: { sourceKey: `job:${job}:returned-early` } })).toBe(1);
    expect(await resolutionOf(agreementId)).toBeNull();
    const rows = await returnedEarlyRows(5000, new Date());
    expect(rows.filter((r) => r.agreementId === agreementId)).toEqual([expect.objectContaining({ settled: false })]);
    await settle(agreementId, standard());
    expect((await returnedEarlyRows(5000, new Date())).some((r) => r.agreementId === agreementId)).toBe(false);
  });

  it("stale-preview-refused", async () => {
    await settings();
    const { agreementId, units } = await rental();
    await pickup(agreementId, units, "2026-09-20");
    const choice: EarlyReturnChoice = { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: 0 };
    const preview = await previewEarlyReturn(agreementId, choice);
    await settings({ pickupDayNotBilled: false }); // the numbers move: the pickup day is now billed
    await expect(applyEarlyReturn(ownerId, agreementId, choice, preview)).rejects.toThrow(/numbers changed/);
    expect(await resolutionOf(agreementId)).toBeNull();
    expect((await agreementOf(agreementId)).status).toBe("ACTIVE");
  });

  it("defaults-changed-before-money-moved", async () => {
    // Automatic: stop billing at pickup, with the fee. Then the owner waives the fee before it is paid.
    await settings({ handling: "APPLY_DEFAULTS", billing: "END_AT_PICKUP" });
    const a = await rental();
    await pickup(a.agreementId, a.units, "2026-09-20");
    const fee = await prisma.invoice.findFirstOrThrow({ where: { agreementId: a.agreementId } });
    expect(fee.status).toBe("OPEN");
    await settle(a.agreementId, { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: 0 });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: fee.id } })).status).toBe("VOID");
    const changed = (await resolutionOf(a.agreementId))!;
    expect([changed.appliedBy, changed.feeCents, changed.feeInvoiceId]).toEqual(["OWNER", 0, null]);

    // Automatic: keep billing (an ending was recorded for the rental). The owner changes it to stop at pickup.
    await settings({ handling: "APPLY_DEFAULTS", billing: "KEEP_TO_AGREED_END" });
    const b = await rental({ fixed: false });
    await pickup(b.agreementId, b.units, "2026-09-20");
    expect((await agreementOf(b.agreementId)).terminationEffectiveOn).not.toBeNull();
    expect((await resolutionOf(b.agreementId))?.appliedBy).toBe("DEFAULTS");
    await settle(b.agreementId, { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: 0 });
    const ended = await agreementOf(b.agreementId);
    expect(ended.status).toBe("ENDED");
    expect(ended.terminationEffectiveOn).toBeNull(); // the automatic ending was taken back first
  });

  it("defaults-change-refused-after-refund", async () => {
    await settings({ handling: "APPLY_DEFAULTS", billing: "END_AT_PICKUP", unused: "REFUND" });
    const { agreementId, units } = await rental();
    await paidInvoice(agreementId, "2026-09-01", 3210, "MANUAL");
    await pickup(agreementId, units, "2026-09-20");
    const resolution = (await resolutionOf(agreementId))!;
    expect(resolution.refundByHandCents).toBe(1177);
    await expect(settle(agreementId, { billing: "END_AT_PICKUP", unusedDays: "KEEP", feeCents: 0 })).rejects.toThrow(/already been refunded or credited/);
    expect((await resolutionOf(agreementId))?.appliedBy).toBe("DEFAULTS");
  });

  it("never-delivered-refund-unchanged (the shared refund helper)", async () => {
    await settings();
    const { agreementId, units } = await rental({ units: 2 });
    await paidInvoice(agreementId, "2026-09-01", 3210, "MANUAL");
    const pending = await prisma.pendingDelivery.create({
      data: { agreementId, rentalLineId: (await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } })).id, applianceId: units[1]!, originalJobId: jobIds[jobIds.length - 1]!, originalDeliveryDate: businessDateFromKey("2025-10-01")! },
    });
    await removeUndeliveredItem(ownerId, pending.id, businessDateFromKey("2026-09-20")!);
    const row = await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: pending.id } });
    expect(row.creditId).toBeNull();
    expect([row.refundedCents, row.refundByHandCents]).toEqual([0, 3210]); // everything that was paid goes back by hand
    expect((await prisma.refund.findMany({ where: { invoice: { agreementId } } })).map((r) => r.amountCents)).toEqual([3210]);
  });

  it("dst-pickup-day-with-actual-days-in-month", async () => {
    // Pickup on 2026-03-08, the day clocks moved forward. March has 31 days: 24 unused days (Mar 8 to Mar 31).
    await settings({ basis: "ACTUAL_DAYS_IN_MONTH" });
    const { agreementId, units } = await rental();
    await pickup(agreementId, units, "2026-03-08");
    const preview = await previewEarlyReturn(agreementId, { billing: "END_AT_PICKUP", unusedDays: "CREDIT", feeCents: 0 });
    expect(preview.lastBilledDay.toISOString().slice(0, 10)).toBe("2026-03-07");
    expect([preview.unusedDaysCount, preview.unusedCents, preview.unusedTaxCents]).toEqual([24, 2323, 163]); // 3,000 × 24 ÷ 31
    await settings({ basis: "MONTHLY_DIV_30" });
    expect((await previewEarlyReturn(agreementId, { billing: "END_AT_PICKUP", unusedDays: "CREDIT", feeCents: 0 })).unusedCents).toBe(2400);
  });
});
