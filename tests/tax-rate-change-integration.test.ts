import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  applyTaxRateChanges,
  retrySubscriptionTaxUpdate,
  subscriptionTaxUpdateKey,
} from "@/domains/tax/rate-changes";
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
      const desired = params.items?.[0]?.tax_rates ?? [];
      const ids = desired.map((rate) =>
        typeof rate === "string" ? rate : String(rate),
      );
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

  it("updates affected taxable subscriptions once, reconciles an ambiguous write, and leaves exempt rent untouched", async () => {
    const first = await applyTaxRateChanges(now);
    expect(first).toMatchObject({
      versions: 1,
      agreements: 3,
      updated: 1,
      skipped: 1,
      pending: 1,
    });

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

    const retry = await applyTaxRateChanges(now);
    expect(retry.pending).toBe(0);
    expect(updateCalls).toHaveLength(2);
  });
});
