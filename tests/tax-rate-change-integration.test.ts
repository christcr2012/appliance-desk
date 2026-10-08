import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  applyTaxRateChanges,
  retrySubscriptionTaxUpdate,
  subscriptionTaxUpdateKey,
  syncSubscriptionTaxRatesForAgreement,
} from "@/domains/tax/rate-changes";
import { TAX_CHARGE_CATEGORIES } from "@/domains/tax/categories";
import { taxRateVersionIdsForAgreement } from "@/domains/tax/locations";
import { businessDateFromKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { __setStripeClientForTests } from "@/lib/stripe";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Batch T rate-change automation (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `tax-rate-owner-${tag}`;
  const taxedUserId = `tax-rate-user-${tag}`;
  const exemptUserId = `tax-rate-exempt-user-${tag}`;
  const taxedCustomerId = `tax-rate-customer-${tag}`;
  const exemptCustomerId = `tax-rate-exempt-customer-${tag}`;
  const taxedAddressId = `tax-rate-address-${tag}`;
  const exemptAddressId = `tax-rate-exempt-address-${tag}`;
  const agreementId = `tax-rate-agreement-${tag}`;
  const ambiguousAgreementId = `tax-rate-ambiguous-agreement-${tag}`;
  const exemptAgreementId = `tax-rate-exempt-agreement-${tag}`;
  const subscriptionId = `sub_tax_rate_${tag}`;
  const ambiguousSubscriptionId = `sub_tax_rate_ambiguous_${tag}`;
  const exemptSubscriptionId = `sub_tax_rate_exempt_${tag}`;
  const newRateVersionId = `tax-rate-new-${tag}`;
  const oldStripeRateId = `txr_old_${tag}`;
  const newStripeRateId = `txr_new_${tag}`;
  const now = new Date("2026-10-07T18:05:00.000Z");
  const effectiveFrom = businessDateFromKey("2026-10-08")!;
  let taxFixture: Awaited<ReturnType<typeof seedTaxReadyContext>>;

  type SimSubscription = {
    id: string;
    items: {
      data: Array<{
        id: string;
        tax_rates: Array<{ id: string }>;
      }>;
    };
  };
  const subscriptions = new Map<string, SimSubscription>();
  const updateCalls: Array<{
    subscriptionId: string;
    taxRateIds: string[];
    idempotencyKey: string | undefined;
  }> = [];
  let ambiguousWritePending = true;

  function putSubscription(id: string, taxRateIds: string[]) {
    subscriptions.set(id, {
      id,
      items: {
        data: [
          {
            id: `si_${id}`,
            tax_rates: taxRateIds.map((rateId) => ({ id: rateId })),
          },
        ],
      },
    });
  }

  const retrieve = vi.fn(async (id: string) => {
    const subscription = subscriptions.get(id);
    if (!subscription) throw new Error(`Missing simulated subscription ${id}`);
    return subscription as unknown as Stripe.Subscription;
  });

  const update = vi.fn(
    async (
      id: string,
      params: Stripe.SubscriptionUpdateParams,
      options?: Stripe.RequestOptions,
    ) => {
      const subscription = subscriptions.get(id);
      if (!subscription) throw new Error(`Missing simulated subscription ${id}`);
      const desired = params.items?.[0]?.tax_rates;
      const ids = Array.isArray(desired) ? [...desired] : [];
      for (const item of subscription.items.data) {
        item.tax_rates = ids.map((rateId) => ({ id: rateId }));
      }
      updateCalls.push({
        subscriptionId: id,
        taxRateIds: ids,
        idempotencyKey: options?.idempotencyKey,
      });

      if (id === ambiguousSubscriptionId && ambiguousWritePending) {
        ambiguousWritePending = false;
        const error = new Error("simulated connection loss after Stripe applied the change") as Error & {
          type?: string;
        };
        error.type = "StripeConnectionError";
        throw error;
      }
      return subscription as unknown as Stripe.Subscription;
    },
  );

  beforeAll(async () => {
    __setStripeClientForTests({
      subscriptions: { retrieve, update },
    } as unknown as Stripe);

    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          email: `${tag}-owner@example.test`,
          name: "Tax rate owner",
          role: "OWNER",
          emailVerified: true,
        },
        {
          id: taxedUserId,
          email: `${tag}-taxed@example.test`,
          name: "Taxed rate-change customer",
          role: "CUSTOMER",
          emailVerified: true,
        },
        {
          id: exemptUserId,
          email: `${tag}-exempt@example.test`,
          name: "Exempt rate-change customer",
          role: "CUSTOMER",
          emailVerified: true,
        },
      ],
    });
    await prisma.customer.createMany({
      data: [
        {
          id: taxedCustomerId,
          userId: taxedUserId,
          referralCode: `TR${tag.slice(0, 16)}`,
        },
        {
          id: exemptCustomerId,
          userId: exemptUserId,
          referralCode: `TE${tag.slice(0, 16)}`,
        },
      ],
    });
    await prisma.serviceAddress.createMany({
      data: [
        {
          id: taxedAddressId,
          customerId: taxedCustomerId,
          line1: "100 Taxed Ave",
          city: "Greeley",
          zip: "80631",
        },
        {
          id: exemptAddressId,
          customerId: exemptCustomerId,
          line1: "200 Exempt Ave",
          city: "Greeley",
          zip: "80631",
        },
      ],
    });

    taxFixture = await seedTaxReadyContext(taxedAddressId, {
      rateMilliPercent: 7_300,
    });
    await prisma.taxRateVersion.update({
      where: { id: taxFixture.rateVersionId },
      data: { stripeTaxRateId: oldStripeRateId },
    });
    await prisma.taxRateVersion.create({
      data: {
        id: newRateVersionId,
        jurisdictionId: taxFixture.jurisdictionId,
        rateMilliPercent: 8_000,
        effectiveFrom,
        source: "MANUAL",
        stripeTaxRateId: newStripeRateId,
      },
    });
    await prisma.addressTaxLocation.create({
      data: {
        serviceAddressId: exemptAddressId,
        status: "VERIFIED",
        source: "MANUAL",
        lookedUpAt: new Date("2026-10-01T18:00:00.000Z"),
        jurisdictions: {
          create: { jurisdictionId: taxFixture.jurisdictionId },
        },
      },
    });
    await prisma.customerTaxExemption.create({
      data: {
        customerId: exemptCustomerId,
        reason: "RESALE",
        jurisdictionIds: [],
        validFrom: new Date("2026-01-01T07:00:00.000Z"),
        verifiedByUserId: ownerId,
      },
    });

    await prisma.rentalAgreement.createMany({
      data: [
        {
          id: agreementId,
          customerId: taxedCustomerId,
          serviceAddressId: taxedAddressId,
          status: "ACTIVE",
          termMonths: 12,
          stripeSubscriptionId: subscriptionId,
        },
        {
          id: ambiguousAgreementId,
          customerId: taxedCustomerId,
          serviceAddressId: taxedAddressId,
          status: "ACTIVE",
          termMonths: 12,
          stripeSubscriptionId: ambiguousSubscriptionId,
        },
        {
          id: exemptAgreementId,
          customerId: exemptCustomerId,
          serviceAddressId: exemptAddressId,
          status: "ACTIVE",
          termMonths: 12,
          stripeSubscriptionId: exemptSubscriptionId,
        },
      ],
    });

    putSubscription(subscriptionId, [oldStripeRateId]);
    putSubscription(ambiguousSubscriptionId, [oldStripeRateId]);
    putSubscription(exemptSubscriptionId, []);
  });

  afterAll(async () => {
    __setStripeClientForTests(null);
    await prisma.providerOperation.deleteMany({
      where: {
        kind: "SUBSCRIPTION_TAX_UPDATE",
        subjectId: {
          in: [agreementId, ambiguousAgreementId, exemptAgreementId],
        },
      },
    });
    await prisma.rentalAgreement.deleteMany({
      where: {
        id: { in: [agreementId, ambiguousAgreementId, exemptAgreementId] },
      },
    });
    await prisma.customerTaxExemption.deleteMany({
      where: { customerId: exemptCustomerId },
    });
    await prisma.addressTaxLocation.deleteMany({
      where: { serviceAddressId: exemptAddressId },
    });
    await taxFixture.cleanup();
    await prisma.serviceAddress.deleteMany({
      where: { id: { in: [taxedAddressId, exemptAddressId] } },
    });
    await prisma.customer.deleteMany({
      where: { id: { in: [taxedCustomerId, exemptCustomerId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, taxedUserId, exemptUserId] } },
    });
  });


  it("marks a zero-item Stripe subscription as drift instead of already current", async () => {
    const emptyAgreementId = `tax-rate-empty-agreement-${tag}`;
    const emptySubscriptionId = `sub_tax_rate_empty_${tag}`;

    await prisma.rentalAgreement.create({
      data: {
        id: emptyAgreementId,
        customerId: taxedCustomerId,
        serviceAddressId: taxedAddressId,
        status: "ACTIVE",
        termMonths: 12,
        stripeSubscriptionId: emptySubscriptionId,
      },
    });
    subscriptions.set(emptySubscriptionId, { id: emptySubscriptionId, items: { data: [] } });

    try {
      expect(
        await syncSubscriptionTaxRatesForAgreement(
          emptyAgreementId,
          newRateVersionId,
          effectiveFrom,
        ),
      ).toBe("pending");

      const operation = await prisma.providerOperation.findUniqueOrThrow({
        where: {
          idempotencyKey: subscriptionTaxUpdateKey(
            emptyAgreementId,
            newRateVersionId,
          ),
        },
      });
      expect(operation.status).toBe("DRIFT");
      expect(updateCalls.some((call) => call.subscriptionId === emptySubscriptionId)).toBe(false);
    } finally {
      await prisma.providerOperation.deleteMany({
        where: {
          kind: "SUBSCRIPTION_TAX_UPDATE",
          subjectId: emptyAgreementId,
        },
      });
      await prisma.rentalAgreement.delete({ where: { id: emptyAgreementId } });
      subscriptions.delete(emptySubscriptionId);
    }
  });

  it("updates affected taxable subscriptions once, reconciles an ambiguous write, and leaves exempt rent untouched", async () => {
    const first = await applyTaxRateChanges(now);
    expect(first.versions).toBeGreaterThanOrEqual(1);
    expect(first.agreements).toBeGreaterThanOrEqual(3);

    expect(
      subscriptions.get(subscriptionId)!.items.data[0]!.tax_rates.map(
        (rate) => rate.id,
      ),
    ).toEqual([newStripeRateId]);
    expect(
      subscriptions
        .get(ambiguousSubscriptionId)!
        .items.data[0]!.tax_rates.map((rate) => rate.id),
    ).toEqual([newStripeRateId]);
    expect(
      subscriptions
        .get(exemptSubscriptionId)!
        .items.data[0]!.tax_rates.map((rate) => rate.id),
    ).toEqual([]);

    const ambiguousOp = await prisma.providerOperation.findUniqueOrThrow({
      where: {
        idempotencyKey: subscriptionTaxUpdateKey(
          ambiguousAgreementId,
          newRateVersionId,
        ),
      },
    });
    expect(ambiguousOp.status).toBe("UNKNOWN");

    expect(
      await retrySubscriptionTaxUpdate({
        id: ambiguousOp.id,
        subjectType: ambiguousOp.subjectType,
        subjectId: ambiguousOp.subjectId,
        idempotencyKey: ambiguousOp.idempotencyKey,
        status: ambiguousOp.status,
        attempts: ambiguousOp.attempts,
      }),
    ).toBe(true);
    expect(
      (
        await prisma.providerOperation.findUniqueOrThrow({
          where: { id: ambiguousOp.id },
        })
      ).status,
    ).toBe("SUCCEEDED");

    expect(updateCalls).toHaveLength(2);
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subscriptionId,
          taxRateIds: [newStripeRateId],
          idempotencyKey: subscriptionTaxUpdateKey(
            agreementId,
            newRateVersionId,
          ),
        }),
        expect.objectContaining({
          subscriptionId: ambiguousSubscriptionId,
          taxRateIds: [newStripeRateId],
          idempotencyKey: subscriptionTaxUpdateKey(
            ambiguousAgreementId,
            newRateVersionId,
          ),
        }),
      ]),
    );

    await applyTaxRateChanges(now);
    expect(updateCalls).toHaveLength(2);
  });

  it("recovers an already-effective rate even when the day-before cron never created an operation", async () => {
    const key = subscriptionTaxUpdateKey(agreementId, newRateVersionId);
    await prisma.providerOperation.deleteMany({
      where: { idempotencyKey: key },
    });
    putSubscription(subscriptionId, [oldStripeRateId]);
    const writesBefore = updateCalls.length;

    const result = await applyTaxRateChanges(
      new Date("2026-10-10T18:05:00.000Z"),
    );

    expect(result.versions).toBeGreaterThanOrEqual(1);
    expect(
      subscriptions
        .get(subscriptionId)!
        .items.data[0]!.tax_rates.map((rate) => rate.id),
    ).toEqual([newStripeRateId]);
    expect(updateCalls).toHaveLength(writesBefore + 1);
    expect(
      (
        await prisma.providerOperation.findUniqueOrThrow({
          where: { idempotencyKey: key },
        })
      ).status,
    ).toBe("SUCCEEDED");
  });

  it("recovers an already-effective rate when durable provider evidence is unresolved", async () => {
    const key = subscriptionTaxUpdateKey(agreementId, newRateVersionId);
    await prisma.providerOperation.update({
      where: { idempotencyKey: key },
      data: {
        status: "FAILED",
        completedAt: null,
        lastError: "synthetic prior outage",
      },
    });
    const writesBefore = updateCalls.length;

    const result = await applyTaxRateChanges(
      new Date("2026-10-10T18:05:00.000Z"),
    );

    expect(result.versions).toBeGreaterThanOrEqual(1);
    expect(
      (
        await prisma.providerOperation.findUniqueOrThrow({
          where: { idempotencyKey: key },
        })
      ).status,
    ).toBe("SUCCEEDED");
    expect(updateCalls).toHaveLength(writesBefore);
  });

  it("reconciles a missed older trigger against the complete current multi-jurisdiction rate set", async () => {
    const countyId = `tax-rate-county-${tag}`;
    const countyCode = `COUNTY-${tag.slice(0, 10)}`;
    const oldCountyVersionId = `tax-rate-county-old-${tag}`;
    const newCountyVersionId = `tax-rate-county-new-${tag}`;
    const oldCountyStripeRateId = `txr_county_old_${tag}`;
    const newCountyStripeRateId = `txr_county_new_${tag}`;

    await prisma.taxJurisdiction.create({
      data: {
        id: countyId,
        code: countyCode,
        name: "Synthetic county",
        level: "COUNTY",
        administration: "STATE_COLLECTED",
        reviewStatus: "REVIEWED",
      },
    });
    await prisma.taxRateVersion.createMany({
      data: [
        {
          id: oldCountyVersionId,
          jurisdictionId: countyId,
          rateMilliPercent: 1_000,
          effectiveFrom: businessDateFromKey("2026-01-01")!,
          source: "MANUAL",
          stripeTaxRateId: oldCountyStripeRateId,
        },
        {
          id: newCountyVersionId,
          jurisdictionId: countyId,
          rateMilliPercent: 1_200,
          effectiveFrom: businessDateFromKey("2026-10-09")!,
          source: "MANUAL",
          stripeTaxRateId: newCountyStripeRateId,
        },
      ],
    });
    await prisma.taxabilityRule.createMany({
      data: TAX_CHARGE_CATEGORIES.map((category) => ({
        jurisdictionId: countyId,
        category,
        taxability: "TAXABLE" as const,
        reason: "Synthetic multi-jurisdiction catch-up fixture",
      })),
    });
    await prisma.addressTaxJurisdiction.create({
      data: {
        addressTaxLocationId: taxFixture.locationId,
        jurisdictionId: countyId,
      },
    });

    try {
      await prisma.providerOperation.deleteMany({
        where: {
          kind: "SUBSCRIPTION_TAX_UPDATE",
          subjectId: agreementId,
          OR: [
            { idempotencyKey: subscriptionTaxUpdateKey(agreementId, newRateVersionId) },
            { idempotencyKey: subscriptionTaxUpdateKey(agreementId, newCountyVersionId) },
          ],
        },
      });
      putSubscription(subscriptionId, [oldStripeRateId, oldCountyStripeRateId]);

      await applyTaxRateChanges(new Date("2026-10-10T18:05:00.000Z"));

      expect(
        subscriptions
          .get(subscriptionId)!
          .items.data[0]!.tax_rates.map((rate) => rate.id)
          .sort(),
      ).toEqual([newStripeRateId, newCountyStripeRateId].sort());
      expect(
        (
          await prisma.providerOperation.findUniqueOrThrow({
            where: {
              idempotencyKey: subscriptionTaxUpdateKey(
                agreementId,
                newCountyVersionId,
              ),
            },
          })
        ).status,
      ).toBe("SUCCEEDED");
    } finally {
      await prisma.providerOperation.deleteMany({
        where: {
          kind: "SUBSCRIPTION_TAX_UPDATE",
          idempotencyKey: {
            in: [
              subscriptionTaxUpdateKey(agreementId, oldCountyVersionId),
              subscriptionTaxUpdateKey(agreementId, newCountyVersionId),
            ],
          },
        },
      });
      await prisma.addressTaxJurisdiction.deleteMany({
        where: {
          addressTaxLocationId: taxFixture.locationId,
          jurisdictionId: countyId,
        },
      });
      await prisma.taxabilityRule.deleteMany({ where: { jurisdictionId: countyId } });
      await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId: countyId } });
      await prisma.taxJurisdiction.delete({ where: { id: countyId } });
    }
  });

  it("ignores an undone auto-applied version at the day-before scheduler boundary", async () => {
    const undoneId = `tax-rate-undone-${tag}`;
    await prisma.taxRateVersion.create({
      data: {
        id: undoneId,
        jurisdictionId: taxFixture.jurisdictionId,
        rateMilliPercent: 8_250,
        effectiveFrom: businessDateFromKey("2026-10-21")!,
        source: "COLORADO_GIS",
        autoApplied: true,
        autoAppliedUndoneAt: new Date("2026-10-19T18:00:00.000Z"),
      },
    });

    try {
      await applyTaxRateChanges(
        new Date("2026-10-20T18:05:00.000Z"),
      );
      expect(
        await prisma.providerOperation.findUnique({
          where: {
            idempotencyKey: subscriptionTaxUpdateKey(agreementId, undoneId),
          },
        }),
      ).toBeNull();
    } finally {
      await prisma.taxRateVersion.deleteMany({ where: { id: undoneId } });
    }
  });

  it("ignores an undone auto-applied rate in agreement current-rate selection", async () => {
    const undoneId = `tax-rate-undone-selection-${tag}`;
    await prisma.taxRateVersion.create({
      data: {
        id: undoneId,
        jurisdictionId: taxFixture.jurisdictionId,
        rateMilliPercent: 9_900,
        effectiveFrom: businessDateFromKey("2026-10-06")!,
        source: "COLORADO_GIS",
        autoApplied: true,
        autoAppliedUndoneAt: new Date("2026-10-06T18:00:00.000Z"),
      },
    });

    try {
      const ids = await prisma.$transaction((tx) =>
        taxRateVersionIdsForAgreement(
          tx,
          agreementId,
          businessDateFromKey("2026-10-07")!,
          "RENTAL",
        ),
      );
      expect(ids).toContain(taxFixture.rateVersionId);
      expect(ids).not.toContain(undoneId);
    } finally {
      await prisma.taxRateVersion.deleteMany({ where: { id: undoneId } });
    }
  });
});
