import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ intent: vi.fn(), invoice: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    paymentIntents: { retrieve: m.intent },
    invoices: { retrieve: m.invoice },
  }),
}));

import { prisma } from "@/lib/prisma";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)(
  "R07 signing-payment dedupe treats both stored success spellings the same",
  () => {
    const tag = randomUUID().replaceAll("-", "");
    const userId = `r7-user-${tag}`;
    const customerId = `r7-customer-${tag}`;
    const addressId = `r7-address-${tag}`;
    const agreements: string[] = [];
    const events: string[] = [];

    function event(type: string, object: unknown): Stripe.Event {
      const id = `evt_r7_${randomUUID()}`;
      events.push(id);
      return { id, type, data: { object } } as Stripe.Event;
    }

    async function agreement() {
      const id = `r7-agreement-${randomUUID()}`;
      agreements.push(id);
      await prisma.rentalAgreement.create({
        data: {
          id,
          customerId,
          serviceAddressId: addressId,
          status: "ACTIVE",
          depositCents: 15_000,
          damageWaiverCents: 2_500,
        },
      });
      return id;
    }

    beforeAll(async () => {
      await prisma.user.create({
        data: {
          id: userId,
          email: `${tag}@example.test`,
          name: "R7 fixture",
          role: "CUSTOMER",
        },
      });
      await prisma.customer.create({
        data: { id: customerId, userId, referralCode: `R7${tag.slice(0, 16)}` },
      });
      await prisma.serviceAddress.create({
        data: {
          id: addressId,
          customerId,
          line1: "7 Status St",
          city: "Denver",
          zip: "80201",
        },
      });
      m.intent.mockImplementation(async (id: string) => ({
        id,
        payment_method: { id: `pm_${id}`, type: "us_bank_account" },
        latest_charge: null,
      }));
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

    it.each(["succeeded", "SUCCEEDED"])(
      "a later event for a payment already stored as %s records no second payment",
      async (storedStatus) => {
        const id = await agreement();
        const paymentIntent = `pi_r7_${randomUUID()}`;
        const data = {
          mode: "payment",
          payment_intent: paymentIntent,
          payment_status: "paid",
          metadata: { agreementId: id },
        };

        await processStripeWebhookEvent(
          event("checkout.session.completed", data),
        );
        // Simulate a historical row saved with the older capitalised spelling.
        await prisma.payment.updateMany({
          where: { invoice: { agreementId: id } },
          data: { status: storedStatus },
        });
        // A different Stripe event for the very same payment (a retry/replay).
        await processStripeWebhookEvent(
          event("checkout.session.async_payment_succeeded", data),
        );

        expect(
          await prisma.payment.count({
            where: { invoice: { agreementId: id } },
          }),
        ).toBe(1);
        expect(
          await prisma.receipt.count({
            where: { payments: { some: { invoice: { agreementId: id } } } },
          }),
        ).toBe(1);
        expect(await prisma.invoice.count({ where: { agreementId: id } })).toBe(
          1,
        );
        expect(await prisma.deposit.count({ where: { agreementId: id } })).toBe(
          1,
        );
      },
    );
  },
);
