import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { prisma } from "@/lib/prisma";

/**
 * R08: no Stripe call may wait while the webhook's database lock is held.
 *
 * Every fake Stripe call below is slow on purpose and, while it is "in flight",
 * tries to take the very advisory lock the webhook transaction uses. If the
 * webhook were still calling Stripe from inside its transaction, that try-lock
 * would fail. It must always succeed.
 */
const m = vi.hoisted(() => ({
  observations: [] as boolean[],
  intent: vi.fn(),
  charge: vi.fn(),
  invoice: vi.fn(),
  setup: vi.fn(),
  gather: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    paymentIntents: { retrieve: m.intent },
    charges: { retrieve: m.charge },
    invoices: { retrieve: m.invoice },
    setupIntents: { retrieve: m.setup },
    invoicePayments: { list: vi.fn() },
  }),
}));

vi.mock("@/domains/billing/webhook-evidence", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/domains/billing/webhook-evidence")>();
  m.gather.mockImplementation(actual.gatherWebhookEvidence);
  return {
    ...actual,
    gatherWebhookEvidence: (event: Stripe.Event) => m.gather(event),
  };
});

import { processStripeWebhookEvent } from "@/domains/billing/webhooks";
import { WebhookEvidence } from "@/domains/billing/webhook-evidence";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

async function advisoryLockIsFree(): Promise<boolean> {
  const rows = await prisma.$transaction(
    (tx) =>
      tx.$queryRaw<
        Array<{ got: boolean }>
      >`SELECT pg_try_advisory_xact_lock(174831, 1) AS got`,
  );
  return rows[0]!.got;
}

async function inFlight<T>(value: T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 40));
  m.observations.push(await advisoryLockIsFree());
  return value;
}

describe.skipIf(!enabled)(
  "R08 webhook provider calls stay outside the database lock",
  () => {
    const tag = randomUUID().replaceAll("-", "");
    const userId = `r8-user-${tag}`;
    const customerId = `r8-customer-${tag}`;
    const addressId = `r8-address-${tag}`;
    const agreements: string[] = [];
    const events: string[] = [];

    function event(type: string, object: unknown): Stripe.Event {
      const id = `evt_r8_${randomUUID()}`;
      events.push(id);
      return { id, type, data: { object } } as Stripe.Event;
    }

    async function agreement(extra: { stripeSubscriptionId?: string } = {}) {
      const id = `r8-agreement-${randomUUID()}`;
      agreements.push(id);
      await prisma.rentalAgreement.create({
        data: {
          id,
          customerId,
          serviceAddressId: addressId,
          status: "ACTIVE",
          depositCents: 15_000,
          damageWaiverCents: 2_500,
          ...extra,
        },
      });
      return id;
    }

    function paymentSession(agreementId: string, paymentIntentId: string) {
      return {
        mode: "payment",
        payment_intent: paymentIntentId,
        payment_status: "paid",
        metadata: { agreementId },
      };
    }

    const paymentCount = (agreementId: string) =>
      prisma.payment.count({ where: { invoice: { agreementId } } });

    beforeAll(async () => {
      await prisma.user.create({
        data: {
          id: userId,
          email: `${tag}@example.test`,
          name: "R8 fixture",
          role: "CUSTOMER",
        },
      });
      await prisma.customer.create({
        data: { id: customerId, userId, referralCode: `R8${tag.slice(0, 16)}` },
      });
      await prisma.serviceAddress.create({
        data: {
          id: addressId,
          customerId,
          line1: "8 Evidence St",
          city: "Denver",
          zip: "80201",
        },
      });
    });

    beforeEach(() => {
      m.observations.length = 0;
      m.intent.mockReset().mockImplementation(async (id: string) =>
        inFlight({
          id,
          payment_method: { id: `pm_${id}`, type: "card" },
          latest_charge: `ch_${id}`,
        }),
      );
      m.charge
        .mockReset()
        .mockImplementation(async (id: string) =>
          inFlight({ id, created: 1_760_000_000 }),
        );
      m.invoice.mockReset();
      m.setup
        .mockReset()
        .mockImplementation(async (id: string) =>
          inFlight({ id, payment_method: `pm_${id}` }),
        );
    });

    afterAll(async () => {
      const invoices = await prisma.invoice.findMany({
        where: { customerId },
        select: { id: true },
      });
      const invoiceIds = invoices.map((row) => row.id);
      await prisma.refund.deleteMany({
        where: { invoiceId: { in: invoiceIds } },
      });
      await prisma.payment.deleteMany({
        where: { invoiceId: { in: invoiceIds } },
      });
      await prisma.invoice.deleteMany({ where: { customerId } });
      await prisma.customerCredit.deleteMany({ where: { customerId } });
      await prisma.deposit.deleteMany({
        where: { agreementId: { in: agreements } },
      });
      await prisma.receipt.deleteMany({ where: { customerId } });
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: agreements } },
      });
      await prisma.rentalAgreement.deleteMany({
        where: { id: { in: agreements } },
      });
      await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.webhookEvent.deleteMany({ where: { id: { in: events } } });
    });

    it("signing payment: every Stripe lookup completes with the lock free, then one payment is recorded", async () => {
      const id = await agreement();
      await processStripeWebhookEvent(
        event(
          "checkout.session.completed",
          paymentSession(id, `pi_r8_sign_${tag}`),
        ),
      );

      // method lookup + payment details lookup + charge lookup
      expect(m.observations.length).toBeGreaterThanOrEqual(3);
      expect(m.observations.every(Boolean)).toBe(true);
      expect(await paymentCount(id)).toBe(1);
    });

    it("asynchronous bank settlement: provider lookups run with the lock free", async () => {
      const id = await agreement();
      await processStripeWebhookEvent(
        event(
          "checkout.session.async_payment_succeeded",
          paymentSession(id, `pi_r8_ach_${tag}`),
        ),
      );
      expect(m.observations.length).toBeGreaterThanOrEqual(2);
      expect(m.observations.every(Boolean)).toBe(true);
      expect(await paymentCount(id)).toBe(1);
    });

    it("card setup: the setup-intent lookup runs with the lock free", async () => {
      const id = await agreement();
      await processStripeWebhookEvent(
        event("checkout.session.completed", {
          mode: "setup",
          setup_intent: `seti_r8_${tag}`,
          metadata: { agreementId: id },
        }),
      );
      expect(m.setup).toHaveBeenCalledTimes(1);
      expect(m.observations.every(Boolean)).toBe(true);
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } }))
          .stripeDefaultPaymentMethodId,
      ).toBe(`pm_seti_r8_${tag}`);
    });

    it("paid subscription invoice: invoice, payment and charge lookups all run with the lock free", async () => {
      const subscriptionId = `sub_r8_${tag}`;
      const id = await agreement({ stripeSubscriptionId: subscriptionId });
      const stripeInvoiceId = `in_r8_paid_${tag}`;
      const fullInvoice = {
        id: stripeInvoiceId,
        status: "paid",
        subtotal: 4_000,
        total_taxes: [],
        amount_due: 4_000,
        amount_paid: 4_000,
        period_start: 1_735_689_600,
        period_end: 1_738_368_000,
        due_date: null,
        parent: { subscription_details: { subscription: subscriptionId } },
        payments: {
          has_more: false,
          data: [
            {
              payment: {
                type: "payment_intent",
                payment_intent: `pi_r8_inv_${tag}`,
              },
            },
          ],
        },
        lines: { data: [{ description: "Monthly rental", amount: 4_000 }] },
      };
      m.invoice.mockImplementation(async () => inFlight(fullInvoice));

      await processStripeWebhookEvent(
        event("invoice.paid", { ...fullInvoice, payments: undefined }),
      );

      expect(m.invoice).toHaveBeenCalledTimes(1);
      expect(m.observations.length).toBeGreaterThanOrEqual(3);
      expect(m.observations.every(Boolean)).toBe(true);
      expect(await paymentCount(id)).toBe(1);
    });

    it("a replayed, already-recorded event makes no Stripe call at all", async () => {
      const id = await agreement();
      const e = event(
        "checkout.session.completed",
        paymentSession(id, `pi_r8_replay_${tag}`),
      );
      await processStripeWebhookEvent(e);
      const callsAfterFirst =
        m.intent.mock.calls.length + m.charge.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThan(0);

      await processStripeWebhookEvent(e);

      expect(m.intent.mock.calls.length + m.charge.mock.calls.length).toBe(
        callsAfterFirst,
      );
      expect(await paymentCount(id)).toBe(1);
      expect(await prisma.webhookEvent.count({ where: { id: e.id } })).toBe(1);
    });

    it("a Stripe failure while gathering evidence leaves nothing recorded, so Stripe's retry is safe", async () => {
      const id = await agreement();
      const e = event(
        "checkout.session.completed",
        paymentSession(id, `pi_r8_fail_${tag}`),
      );
      m.intent.mockRejectedValueOnce(new Error("simulated Stripe outage"));

      await expect(processStripeWebhookEvent(e)).rejects.toThrow(
        /simulated Stripe outage/,
      );
      expect(await prisma.webhookEvent.count({ where: { id: e.id } })).toBe(0);
      expect(await paymentCount(id)).toBe(0);

      await processStripeWebhookEvent(e);
      expect(await paymentCount(id)).toBe(1);
      expect(await prisma.webhookEvent.count({ where: { id: e.id } })).toBe(1);
    });

    it("evidence found missing under the lock is fetched outside it, then the event applies once", async () => {
      const id = await agreement();
      const e = event(
        "checkout.session.completed",
        paymentSession(id, `pi_r8_refill_${tag}`),
      );
      // Simulate the early check deciding nothing was needed.
      m.gather.mockImplementationOnce(async () => new WebhookEvidence());

      await processStripeWebhookEvent(e);

      expect(m.observations.length).toBeGreaterThanOrEqual(3);
      expect(m.observations.every(Boolean)).toBe(true);
      expect(await paymentCount(id)).toBe(1);
      expect(await prisma.webhookEvent.count({ where: { id: e.id } })).toBe(1);
    });
  },
);
