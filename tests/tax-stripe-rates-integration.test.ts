import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import { ensureStripeTaxRate, stripePercentageText } from "@/domains/tax/stripe-rates";
import { prisma } from "@/lib/prisma";
import { __setStripeClientForTests } from "@/lib/stripe";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Batch T Stripe tax rates (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const jurisdictionId = `tax-stripe-jurisdiction-${tag}`;
  const rateVersionId = `tax-stripe-rate-${tag}`;
  const create = vi.fn(async () => ({ id: `txr_${tag}` }));
  const originalStripeKey = process.env.STRIPE_SECRET_KEY;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_batch_t_tax_rates";
    __setStripeClientForTests({ taxRates: { create } } as unknown as Stripe);
    await prisma.taxJurisdiction.create({
      data: {
        id: jurisdictionId,
        code: `TS-${tag.slice(0, 8)}`,
        name: "Synthetic Stripe Jurisdiction",
        level: "CITY",
        administration: "STATE_COLLECTED",
        reviewStatus: "REVIEWED",
      },
    });
    await prisma.taxRateVersion.create({
      data: {
        id: rateVersionId,
        jurisdictionId,
        rateMilliPercent: 4110,
        effectiveFrom: new Date("2026-10-01T06:00:00.000Z"),
        source: "MANUAL",
      },
    });
  });

  afterAll(async () => {
    __setStripeClientForTests(null);
    if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalStripeKey;
    await prisma.providerOperation.deleteMany({ where: { subjectId: rateVersionId } });
    await prisma.taxRateVersion.deleteMany({ where: { id: rateVersionId } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
  });

  it("formats integer milli-percent without floating-point arithmetic", () => {
    expect(stripePercentageText(4110)).toBe("4.11");
    expect(stripePercentageText(2900)).toBe("2.9");
    expect(stripePercentageText(7000)).toBe("7");
  });

  it("creates one durable Stripe rate and reuses it on retry", async () => {
    await expect(ensureStripeTaxRate(rateVersionId)).resolves.toBe(`txr_${tag}`);
    await expect(ensureStripeTaxRate(rateVersionId)).resolves.toBe(`txr_${tag}`);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: "Sales tax",
        jurisdiction: "Synthetic Stripe Jurisdiction",
        percentage: "4.11",
        inclusive: false,
        country: "US",
        state: "CO",
        tax_type: "sales_tax",
        metadata: {
          rateVersionId,
          jurisdictionCode: `TS-${tag.slice(0, 8)}`,
        },
      }),
      { idempotencyKey: `tax-rate-${rateVersionId}` },
    );

    expect(
      await prisma.taxRateVersion.findUniqueOrThrow({ where: { id: rateVersionId } }),
    ).toMatchObject({ stripeTaxRateId: `txr_${tag}` });
    expect(
      await prisma.providerOperation.findUniqueOrThrow({
        where: { idempotencyKey: `tax-rate-${rateVersionId}` },
      }),
    ).toMatchObject({ status: "SUCCEEDED", providerObjectId: `txr_${tag}` });
  });
});
