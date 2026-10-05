// Real-Postgres proof for the money workspace (docs/designs/BATCH-D.md D5). Runs only in CI / the sandbox.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyCreditDecision, getSpendableCredits } from "@/domains/billing/money-decisions";
import { getDepositLiability } from "@/domains/billing/deposit-liability";
import { getWaitingForStripe } from "@/domains/billing/waiting-for-stripe";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("money decisions, deposits owed, waiting for Stripe", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ids = {
    customerUser: `md-cu-${tag}`,
    otherUser: `md-ou-${tag}`,
    owner: `md-o-${tag}`,
    staff: `md-s-${tag}`,
    customer: `md-c-${tag}`,
    other: `md-oc-${tag}`,
    address: `md-a-${tag}`,
  };
  const invoiceIds: string[] = [];
  const creditIds: string[] = [];
  const agreementIds: string[] = [];
  const depositIds: string[] = [];
  const opIds: string[] = [];

  async function invoice(customerId = ids.customer, status: "OPEN" | "PAID" = "OPEN") {
    const id = `md-i-${randomUUID()}`;
    invoiceIds.push(id);
    await prisma.invoice.create({
      data: { id, customerId, status, subtotalCents: 10_000, amountDueCents: 10_000, amountPaidCents: status === "PAID" ? 10_000 : 0 },
    });
    return id;
  }
  async function credit(cents: number, customerId = ids.customer) {
    const id = `md-cr-${randomUUID()}`;
    creditIds.push(id);
    await prisma.customerCredit.create({ data: { id, customerId, amountCents: cents, remainingCents: cents, reason: "Goodwill credit" } });
    return id;
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ids.customerUser, email: `${tag}-c@example.test`, name: "Money Customer", role: "CUSTOMER", emailVerified: true },
        { id: ids.otherUser, email: `${tag}-oc@example.test`, name: "Other Customer", role: "CUSTOMER", emailVerified: true },
        { id: ids.owner, email: `${tag}-o@example.test`, name: "Owner", role: "OWNER", emailVerified: true },
        { id: ids.staff, email: `${tag}-s@example.test`, name: "Staff", role: "STAFF", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: ids.customer, userId: ids.customerUser, referralCode: `M${tag.slice(0, 18)}` } });
    await prisma.customer.create({ data: { id: ids.other, userId: ids.otherUser, referralCode: `N${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: ids.address, customerId: ids.customer, line1: "1 Money St", city: "Greeley", zip: "80631" } });
  });

  afterAll(async () => {
    await prisma.creditApplication.deleteMany({ where: { creditId: { in: creditIds } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.customerCredit.deleteMany({ where: { id: { in: creditIds } } });
    await prisma.deposit.deleteMany({ where: { id: { in: depositIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.providerOperation.deleteMany({ where: { id: { in: opIds } } });
    await prisma.serviceAddress.deleteMany({ where: { id: ids.address } });
    await prisma.customer.deleteMany({ where: { id: { in: [ids.customer, ids.other] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.customerUser, ids.otherUser, ids.owner, ids.staff] } } });
  });

  it("an owner can pay part of an open invoice with credit; the invoice, credit and audit row all agree", async () => {
    const inv = await invoice();
    const cr = await credit(4_000);
    await applyCreditDecision(ids.owner, { creditId: cr, invoiceId: inv, amountCents: 2_500 });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv } });
    const credited = await prisma.customerCredit.findUniqueOrThrow({ where: { id: cr } });
    expect(after.amountPaidCents).toBe(2_500);
    expect(after.status).toBe("PARTIALLY_PAID");
    expect(credited.remainingCents).toBe(1_500);
    expect(await prisma.creditApplication.count({ where: { creditId: cr, invoiceId: inv, appliedByUserId: ids.owner } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "credit.applied_to_invoice", entityId: inv, userId: ids.owner } })).toBe(1);
    expect((await getSpendableCredits(ids.customer)).find((c) => c.id === cr)?.remainingCents).toBe(1_500);
  });

  it("staff cannot apply credit, and nothing changes", async () => {
    const inv = await invoice();
    const cr = await credit(1_000);
    await expect(applyCreditDecision(ids.staff, { creditId: cr, invoiceId: inv, amountCents: 500 })).rejects.toThrow(/no longer has access/);
    expect((await prisma.customerCredit.findUniqueOrThrow({ where: { id: cr } })).remainingCents).toBe(1_000);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv } })).amountPaidCents).toBe(0);
  });

  it("refuses more than the credit has, more than the invoice owes, another customer's credit, and a paid invoice", async () => {
    const inv = await invoice();
    const cr = await credit(1_000);
    await expect(applyCreditDecision(ids.owner, { creditId: cr, invoiceId: inv, amountCents: 1_001 })).rejects.toThrow(/enough remaining/);
    const small = await credit(50_000);
    await expect(applyCreditDecision(ids.owner, { creditId: small, invoiceId: inv, amountCents: 10_001 })).rejects.toThrow(/exceeds the invoice/);
    const theirs = await credit(1_000, ids.other);
    await expect(applyCreditDecision(ids.owner, { creditId: theirs, invoiceId: inv, amountCents: 500 })).rejects.toThrow(/another customer/);
    const paid = await invoice(ids.customer, "PAID");
    await expect(applyCreditDecision(ids.owner, { creditId: cr, invoiceId: paid, amountCents: 100 })).rejects.toThrow(/open invoice/);
    await expect(applyCreditDecision(ids.owner, { creditId: cr, invoiceId: inv, amountCents: 0 })).rejects.toThrow(/positive/);
    await expect(applyCreditDecision(ids.owner, { creditId: cr, invoiceId: inv, amountCents: 1.5 })).rejects.toThrow(/positive/);
  });

  it("deposits owed: only refundable, undecided deposits are counted, in the right age group", async () => {
    async function deposit(status: "ACTIVE" | "ENDED", endedDaysAgo: number | null, extra: { refundable?: boolean; refundedAt?: Date } = {}) {
      const agreementId = `md-ag-${randomUUID()}`;
      agreementIds.push(agreementId);
      await prisma.rentalAgreement.create({
        data: {
          id: agreementId,
          customerId: ids.customer,
          serviceAddressId: ids.address,
          status,
          endDate: endedDaysAgo === null ? null : new Date(Date.now() - endedDaysAgo * 86_400_000),
        },
      });
      const id = `md-d-${randomUUID()}`;
      depositIds.push(id);
      await prisma.deposit.create({ data: { id, agreementId, amountCents: 5_000, ...extra } });
      return id;
    }
    const active = await deposit("ACTIVE", null);
    const recent = await deposit("ENDED", 10);
    const middle = await deposit("ENDED", 60);
    const old = await deposit("ENDED", 120);
    const decided = await deposit("ENDED", 120, { refundedAt: new Date() });
    const kept = await deposit("ENDED", 120, { refundable: false });

    const liability = await getDepositLiability();
    const mine = new Map(liability.rows.filter((r) => r.customerId === ids.customer).map((r) => [r.depositId, r]));
    expect(mine.get(active)?.bucket).toBe("STILL_RENTING");
    expect(mine.get(recent)?.bucket).toBe("DAYS_0_30");
    expect(mine.get(middle)?.bucket).toBe("DAYS_31_90");
    expect(mine.get(old)?.bucket).toBe("OVER_90");
    expect(mine.get(old)?.overdue).toBe(true);
    expect(mine.has(decided)).toBe(false);
    expect(mine.has(kept)).toBe(false);
    expect(liability.totalCents).toBe(liability.rows.reduce((sum, r) => sum + r.amountCents, 0));
  });

  it("waiting for Stripe lists unfinished requests with their plain meaning, and not finished ones", async () => {
    const make = async (status: "PENDING" | "UNKNOWN" | "FAILED" | "SUCCEEDED") => {
      const id = `md-op-${randomUUID()}`;
      opIds.push(id);
      await prisma.providerOperation.create({
        data: { id, kind: "REFUND_CREATE", subjectType: "Refund", subjectId: id, idempotencyKey: `idem-${id}`, status, lastError: status === "FAILED" ? "card_declined" : null },
      });
      return id;
    };
    const pending = await make("PENDING");
    const unknown = await make("UNKNOWN");
    const failed = await make("FAILED");
    const done = await make("SUCCEEDED");
    const waiting = await getWaitingForStripe(500);
    const byId = new Map(waiting.operations.map((o) => [o.id, o]));
    expect(byId.get(pending)?.what).toBe("Refunding money to the customer's card or bank");
    expect(byId.get(unknown)?.meaning).toMatch(/cannot tell whether Stripe did it/);
    expect(byId.get(failed)?.lastError).toBe("card_declined");
    expect(byId.has(done)).toBe(false);
  });
});
