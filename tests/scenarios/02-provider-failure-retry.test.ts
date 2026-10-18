// PLAN scenario 2 (BATCH-F WU-F3): Stripe fails while recurring billing starts. A definite failure is recorded and can be
// retried with the same idempotency key until exactly one subscription exists; an ambiguous outcome (a dropped
// connection) is never blindly repeated and waits for reconciliation. Stripe is faked at the client boundary.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const tag = randomUUID().replaceAll("-", "");
const fake = vi.hoisted(() => ({
  script: [] as Array<"reject" | "drop" | "ok">,
  calls: 0,
  keys: [] as Array<string | undefined>,
  subscriptions: [] as string[],
  params: null as Stripe.SubscriptionCreateParams | null,
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    products: { create: async () => ({ id: `prod_s2_${tag}` }) },
    subscriptions: {
      create: async (params: Stripe.SubscriptionCreateParams, options?: { idempotencyKey?: string }) => {
        fake.calls++;
        fake.keys.push(options?.idempotencyKey);
        const step = fake.script.shift() ?? "ok";
        if (step === "reject") {
          // A definite rejection; the text carries a key-shaped string that must never be stored.
          throw Object.assign(new Error("Your card was declined. Contact " + ["sk_test_", "ABCDEF1234567890abcdef"].join("") + " for details."), { type: "StripeCardError" });
        }
        if (step === "drop") throw Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" });
        fake.params = params;
        const id = `sub_s2_${tag}_${fake.subscriptions.length}`;
        fake.subscriptions.push(id);
        return { id, latest_invoice: `in_s2_${tag}` };
      },
    },
    invoices: {
      retrieve: async () => ({
        id: `in_s2_${tag}`, livemode: false, billing_reason: "subscription_create", currency: "usd", customer: fake.params?.customer, status: "open",
        parent: { subscription_details: { subscription: fake.subscriptions.at(-1) } },
      }),
      listLineItems: async () => ({
        has_more: false,
        data: (fake.params?.add_invoice_items ?? []).map((row, i) => ({ id: `il_s2_${tag}_${i}`, livemode: false, invoice: `in_s2_${tag}`, amount: row.price_data?.unit_amount, metadata: row.metadata })),
      }),
    },
  }),
}));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }) }));
let owner = "";
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: owner, role: "OWNER", archivedAt: null } }) } } }));
vi.mock("@/domains/security/two-factor", () => ({ twoFactorEnrollmentRequired: async () => false }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { prisma } from "@/lib/prisma";
import { startRecurringBillingForAgreement } from "@/domains/billing/checkout";
import { getExceptions } from "@/domains/exceptions";
import { createSyntheticW22V2Order } from "../helpers/w22-v2-order";
import { deliverMachines, reviewSignAndPay, purgeScenarioQueues } from "../helpers/scenario-order";

const scenarioStartedAt = new Date();
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(url.hostname);

describe.skipIf(!enabled)("scenario 2: provider failure and retry", () => {
  const cleanups: Array<() => Promise<void>> = [];
  beforeAll(async () => {
    owner = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
  });
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    for (const cleanup of cleanups.reverse()) await cleanup();
  });

  it("records a definite rejection, shows it to the owner, and a retry creates exactly one subscription", async () => {
    const fixture = await createSyntheticW22V2Order();
    cleanups.push(fixture.cleanup);
    const { agreementId, jobId } = await reviewSignAndPay(fixture, 0, "s2a");
    fake.script = ["reject"];
    const before = fake.calls;

    // Delivery completes (the machines really are there) even though the billing hand-off is rejected.
    await deliverMachines(fixture, agreementId, jobId, 2, "s2a");
    expect(fake.calls - before).toBe(1);
    const delivered = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    expect(delivered.firstDeliveredOn).not.toBeNull();
    expect(delivered.stripeSubscriptionId).toBeNull();
    expect(delivered.billingBlockedReason).toMatch(/Couldn't start billing/);
    const op = await prisma.providerOperation.findUniqueOrThrow({ where: { idempotencyKey: `subscription-create-${agreementId}` } });
    expect(op.status).toBe("FAILED");
    // The provider's text is stored without the key-shaped secret.
    expect(op.lastError ?? "").not.toMatch(/ABCDEF1234567890abcdef/);

    // The owner sees it as a billing problem, not silence.
    const items = await getExceptions();
    expect(items.some((item) => item.category === "BILLING_BLOCKED" && JSON.stringify(item).includes(agreementId))).toBe(true);

    // Retry: same idempotency key, exactly one subscription, the block clears, the operation succeeds.
    const outcome = await startRecurringBillingForAgreement(agreementId);
    expect(outcome.state).toBe("DONE");
    expect(fake.subscriptions.filter((id) => id.startsWith(`sub_s2_${tag}`))).toHaveLength(1);
    expect(new Set(fake.keys.slice(-2)).size).toBe(1);
    const after = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } });
    expect(after.stripeSubscriptionId).toBe(fake.subscriptions[0]);
    expect(after.billingBlockedReason).toBeNull();
    expect((await prisma.providerOperation.findUniqueOrThrow({ where: { id: op.id } })).status).toBe("SUCCEEDED");

    // A further retry after success changes nothing and calls Stripe no more.
    const calls = fake.calls;
    expect((await startRecurringBillingForAgreement(agreementId)).state).toBe("DONE");
    expect(fake.calls).toBe(calls);
    expect(fake.subscriptions).toHaveLength(1);
  });

  it("never repeats an ambiguous outcome: a dropped connection waits for reconciliation", async () => {
    const fixture = await createSyntheticW22V2Order();
    cleanups.push(fixture.cleanup);
    const { agreementId, jobId } = await reviewSignAndPay(fixture, 0, "s2b");
    fake.script = ["drop"];
    const subscriptionsBefore = fake.subscriptions.length;
    const callsBefore = fake.calls;
    await deliverMachines(fixture, agreementId, jobId, 2, "s2b");
    expect(fake.calls - callsBefore).toBe(1);
    const op = await prisma.providerOperation.findUniqueOrThrow({ where: { idempotencyKey: `subscription-create-${agreementId}` } });
    expect(op.status).toBe("UNKNOWN");
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).billingBlockedReason).toMatch(/reconcil|unknown|check/i);

    // Retrying does not call Stripe again and reports the unknown state; nothing is created twice.
    const retry = await startRecurringBillingForAgreement(agreementId);
    expect(retry.state).toBe("UNKNOWN");
    expect(fake.calls - callsBefore).toBe(1);
    expect(fake.subscriptions).toHaveLength(subscriptionsBefore);
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).stripeSubscriptionId).toBeNull();
    expect((await prisma.providerOperation.findUniqueOrThrow({ where: { id: op.id } })).status).toBe("UNKNOWN");
  });
});
