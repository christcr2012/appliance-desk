import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { convertEstimateToAgreements } from "@/domains/estimates";
import { getPreparedEstimateQuoteInTx } from "@/domains/estimates/preapproval-quote";
import { prisma } from "@/lib/prisma";

vi.mock("@/domains/estimates/preapproval-quote", () => ({
  getPreparedEstimateQuoteInTx: vi.fn(),
}));
const mockedQuote = vi.mocked(getPreparedEstimateQuoteInTx);

/**
 * FEETAX-2 (Codex regression): converting an approved estimate whose
 * address became "rules not decided" after approval. The prepared
 * quote is mocked with the real quote's contract — it reports
 * REVIEW_REQUIRED until the agreement carries the owner's recorded
 * override, then READY — so the test proves the conversion records
 * the owner's override BEFORE it recomputes and validates the quote.
 * (The real quote honours a recorded override through
 * assertDeliveryReadyInTx, covered by the delivery-readiness suite.)
 */
const maybeDescribe = process.env.DATABASE_URL ? describe : describe.skip;

const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const QUOTE_F = "a".repeat(64);
const ORDER_F = "b".repeat(64);

let ownerId = "";
let customerId = "";
let addressId = "";
let jurisdictionId = "";
let estimateId = "";
let shellId = "";
let packageId = "";

maybeDescribe("FEETAX-2 conversion override ordering (real Postgres)", () => {
  beforeAll(async () => {
    const owner = await prisma.user.findFirstOrThrow({
      where: { role: "OWNER", archivedAt: null },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    ownerId = owner.id;

    const userId = `drc-user-${tag}`;
    customerId = `drc-customer-${tag}`;
    addressId = `drc-address-${tag}`;
    jurisdictionId = `drc-jur-${tag}`;
    await prisma.user.create({
      data: { id: userId, email: `drc-${tag}@example.test`, role: "CUSTOMER" },
    });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: `DRC${tag.slice(0, 8)}` },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "1 Readiness Test Way",
        city: "Testville",
        state: "CO",
        zip: "80631",
      },
    });
    await prisma.taxJurisdiction.create({
      data: {
        id: jurisdictionId,
        code: `DRC${tag.slice(0, 6)}`.toUpperCase(),
        name: `Test conversion ${tag}`,
        level: "CITY",
        administration: "SELF_COLLECTED",
        reviewStatus: "REVIEWED",
      },
    });
    await prisma.jurisdictionReadiness.create({
      data: {
        jurisdictionId,
        licenseRequired: "NONE",
        filesThrough: "SUTS",
        reviewStatus: "REVIEWED",
      },
    });
    // The rent rule starts DECIDED (the estimate was approved while
    // the address was ready) and is flipped to UNDECIDED below.
    await prisma.taxabilityRule.create({
      data: { jurisdictionId, category: "RENTAL", taxability: "TAXABLE" },
    });
    await prisma.addressTaxLocation.create({
      data: {
        serviceAddressId: addressId,
        status: "VERIFIED",
        source: "MANUAL",
        lookedUpAt: new Date(),
        isCurrent: true,
        jurisdictions: { create: [{ jurisdictionId }] },
      },
    });

    const pkg = await prisma.rentalPackage.create({
      data: {
        name: `Conversion ${tag}`,
        slug: `drc-${tag}`,
        isActive: true,
        monthlyPriceCents: 6000,
      },
    });
    packageId = pkg.id;
    const estimate = await prisma.estimate.create({
      data: {
        customerId,
        createdByUserId: ownerId,
        title: "Conversion override ordering",
        status: "DRAFT",
      },
    });
    estimateId = estimate.id;
    await prisma.estimateLineItem.create({
      data: {
        estimateId,
        serviceAddressId: addressId,
        packageId,
        description: "Washer and dryer set",
        quantity: 1,
        monthlyPriceCents: 6000,
      },
    });
    const shell = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "DRAFT",
        sourceEstimateId: estimateId,
      },
    });
    shellId = shell.id;
    await prisma.estimate.update({
      where: { id: estimateId },
      data: {
        status: "APPROVED",
        reviewedQuoteFingerprint: QUOTE_F,
        reviewedOrderFingerprint: ORDER_F,
        reviewedQuoteAt: new Date(),
      },
    });

    mockedQuote.mockImplementation((async (
      tx: {
        rentalAgreement: {
          findMany: (args: unknown) => Promise<Array<{
            id: string;
            serviceAddressId: string;
            readinessOverrideByUserId: string | null;
          }>>;
        };
      },
      id: string,
    ) => {
      const agreements = await tx.rentalAgreement.findMany({
        where: { sourceEstimateId: id },
        orderBy: { id: "asc" },
      });
      const overridden =
        agreements.length > 0 &&
        agreements.every((a) => a.readinessOverrideByUserId);
      if (!overridden) {
        return {
          status: "REVIEW_REQUIRED",
          reasons: ["The rental tax rule for this address isn't decided yet."],
          permissionToCollect: false,
          quoteFingerprint: null,
          orderFingerprint: null,
          locations: [],
          totals: null,
        };
      }
      return {
        status: "READY",
        reasons: [],
        permissionToCollect: false,
        quoteFingerprint: QUOTE_F,
        orderFingerprint: ORDER_F,
        locations: agreements.map((a) => ({
          agreementId: a.id,
          serviceAddressId: a.serviceAddressId,
          serviceAddress: "1 Readiness Test Way",
          monthlyRentCents: 6000,
          monthlyRentTaxCents: 0,
          setupFeeCents: 0,
          setupTaxCents: 0,
          advanceCents: 0,
          signingAmountCents: 0,
          rateVersionIds: [],
        })),
        totals: {
          monthlyRentCents: 6000,
          monthlyRentTaxCents: 0,
          setupFeeCents: 0,
          setupTaxCents: 0,
          advanceCents: 0,
          dueAtSigningCents: 0,
        },
      };
    }) as never);

    // After approval, the place's rent rule becomes undecided.
    await prisma.taxabilityRule.update({
      where: {
        jurisdictionId_category: { jurisdictionId, category: "RENTAL" },
      },
      data: { taxability: "UNDECIDED" },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [estimateId, shellId] } },
    });
    await prisma.rentalAgreement.deleteMany({ where: { id: shellId } });
    await prisma.estimate.deleteMany({ where: { id: estimateId } });
    await prisma.rentalPackage.deleteMany({ where: { id: packageId } });
    await prisma.addressTaxLocation.deleteMany({
      where: { serviceAddressId: addressId },
    });
    await prisma.jurisdictionReadiness.deleteMany({
      where: { jurisdictionId },
    });
    await prisma.taxabilityRule.deleteMany({ where: { jurisdictionId } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({
      where: { email: `drc-${tag}@example.test` },
    });
  });

  it("without an override the conversion still refuses", async () => {
    await expect(
      convertEstimateToAgreements(ownerId, estimateId, {
        mode: "single",
        serviceAddressId: addressId,
      }),
    ).rejects.toThrow();
    const shell = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: shellId },
    });
    expect(shell.readinessOverrideByUserId).toBeNull();
  });

  it("the owner's conversion override is recorded before the quote is validated", async () => {
    const ids = await convertEstimateToAgreements(ownerId, estimateId, {
      mode: "single",
      serviceAddressId: addressId,
      overrideReason: "CPA confirmed the treatment verbally; note to file.",
    });
    expect(ids).toEqual([shellId]);
    const shell = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: shellId },
    });
    expect(shell.readinessOverrideByUserId).toBe(ownerId);
    const estimate = await prisma.estimate.findUniqueOrThrow({
      where: { id: estimateId },
    });
    expect(estimate.status).toBe("CONVERTED");
  });
});
