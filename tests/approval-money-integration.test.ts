import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refundCreate: vi.fn(),
  checkoutSessionsList: vi.fn(),
  paymentIntentRetrieve: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    refunds: { create: (...args: unknown[]) => mocks.refundCreate(...args) },
    checkout: { sessions: { list: (...args: unknown[]) => mocks.checkoutSessionsList(...args) } },
    paymentIntents: { retrieve: (...args: unknown[]) => mocks.paymentIntentRetrieve(...args) },
  }),
}));

import { prisma } from "@/lib/prisma";
import {
  assertRefundWithinLimit, decideApproval, finishApprovedRequest, listDecidedApprovals, saveApprovalLimits, submitCreditApply, submitDepositDecision, submitHeldPaymentRefund, submitInvoiceRefund,
  type SubmitResult,
} from "@/domains/approvals";

// Batch O-3B on real Postgres with a FAKE Stripe: refunds, deposit decisions, held-payment refunds and credits wait for
// the owner at or above the limit, run exactly once on approval, and never claim success Stripe did not give.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

type Fixture = { userId: string; customerId: string; agreementId: string; addressId: string; depositId: string; invoiceId: string; receiptId: string; paymentId: string };

describe.skipIf(!enabled)("money approvals on real Postgres with a fake Stripe", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const adminId = `am-admin-${tag}`;
  let ownerId: string;
  let saved: { approvalThresholds: unknown; approvalExpiryDays: number };
  const fixtures: Fixture[] = [];

  const fixture = async (opts: { source?: "STRIPE" | "MANUAL"; held?: boolean } = {}): Promise<Fixture> => {
    const n = `${tag}${fixtures.length}`;
    const source = opts.source ?? "STRIPE";
    const user = await prisma.user.create({ data: { id: `am-user-${n}`, email: `am-${n}@example.test`, name: "Money Customer", role: "CUSTOMER", emailVerified: true } });
    const customer = await prisma.customer.create({ data: { id: `am-cust-${n}`, userId: user.id, referralCode: `M${n}`.slice(0, 20) } });
    const address = await prisma.serviceAddress.create({ data: { id: `am-addr-${n}`, customerId: customer.id, line1: "1 Money Way", city: "Greeley", zip: "80631" } });
    const agreement = await prisma.rentalAgreement.create({ data: { id: `am-agr-${n}`, customerId: customer.id, serviceAddressId: address.id, status: "ACTIVE", depositCents: 20_000 } });
    const deposit = await prisma.deposit.create({ data: { id: `am-dep-${n}`, agreementId: agreement.id, amountCents: 20_000, refundable: true } });
    const invoice = await prisma.invoice.create({
      data: {
        id: `am-inv-${n}`, customerId: customer.id, agreementId: agreement.id, status: "PAID", subtotalCents: 20_000, amountDueCents: 20_000, amountPaidCents: 20_000,
        lineItems: { create: { kind: "DEPOSIT", description: "Security deposit", amountCents: 20_000 } },
      },
    });
    const receipt = await prisma.receipt.create({
      data: {
        id: `am-rcpt-${n}`, customerId: customer.id, source, amountCents: 20_000, method: source === "STRIPE" ? "card" : "cash",
        stripeChargeId: source === "STRIPE" ? `ch_am_${n}` : null, receivedOn: new Date("2026-10-02T18:00:00Z"),
        payments: { create: { id: `am-pay-${n}`, invoiceId: invoice.id, amountCents: 20_000, method: source === "STRIPE" ? "card" : "cash", status: opts.held ? "held" : "succeeded" } },
      },
    });
    if (!opts.held) await prisma.deposit.update({ where: { id: deposit.id }, data: { sourceReceiptId: receipt.id } });
    const f = { userId: user.id, customerId: customer.id, agreementId: agreement.id, addressId: address.id, depositId: deposit.id, invoiceId: invoice.id, receiptId: receipt.id, paymentId: `am-pay-${n}` };
    fixtures.push(f);
    return f;
  };

  const request = (r: SubmitResult) => {
    if (r.status === "DONE") throw new Error("expected the request to wait for the owner");
    return r.requestId;
  };

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.user.create({ data: { id: adminId, name: "Money Admin", email: `${tag}-admin@example.test`, role: "ADMIN", emailVerified: true } });
    saved = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { approvalThresholds: true, approvalExpiryDays: true } });
    await saveApprovalLimits(ownerId, { limitsCents: { REFUND: 5_000, DEPOSIT_KEPT: 5_000, CREDIT: 5_000 }, expiryDays: 7 });
  });
  beforeEach(() => {
    mocks.refundCreate.mockReset().mockResolvedValue({ id: `re_${randomUUID()}` });
    mocks.checkoutSessionsList.mockReset().mockResolvedValue({ data: [] });
    mocks.paymentIntentRetrieve.mockReset();
  });
  afterEach(async () => {
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: adminId } });
  });
  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { approvalThresholds: saved.approvalThresholds as object, approvalExpiryDays: saved.approvalExpiryDays } });
    const invoiceIds = fixtures.map((f) => f.invoiceId);
    const refunds = await prisma.refund.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } });
    await prisma.providerOperation.deleteMany({ where: { OR: [{ subjectType: "Deposit", subjectId: { in: fixtures.map((f) => f.depositId) } }, { subjectType: "Refund", subjectId: { in: refunds.map((r) => r.id) } }] } });
    await prisma.creditApplication.deleteMany({ where: { credit: { customerId: { in: fixtures.map((f) => f.customerId) } } } });
    await prisma.customerCredit.deleteMany({ where: { customerId: { in: fixtures.map((f) => f.customerId) } } });
    await prisma.approvalRequest.deleteMany({ where: { requestedByUserId: adminId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: adminId }, { userId: ownerId, entityType: "ApprovalRequest" }] } });
    await prisma.refund.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.deposit.deleteMany({ where: { id: { in: fixtures.map((f) => f.depositId) } } });
    await prisma.receipt.deleteMany({ where: { customerId: { in: fixtures.map((f) => f.customerId) } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: fixtures.map((f) => f.agreementId) } } });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: fixtures.map((f) => f.addressId) } } });
    await prisma.customer.deleteMany({ where: { id: { in: fixtures.map((f) => f.customerId) } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, ...fixtures.map((f) => f.userId)] } } });
  });

  it("a refund below the limit happens at once; at or above it waits and Stripe is not called", async () => {
    const f = await fixture();
    const small = await submitInvoiceRefund(adminId, { invoiceId: f.invoiceId, amountCents: 4_999, reason: "GOODWILL", notes: "small goodwill" });
    expect(small.status).toBe("DONE");
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    mocks.refundCreate.mockClear();
    const big = await submitInvoiceRefund(adminId, { invoiceId: f.invoiceId, amountCents: 5_000, reason: "GOODWILL", notes: "bigger goodwill" });
    expect(big.status).toBe("SENT_FOR_APPROVAL");
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(await prisma.refund.count({ where: { invoiceId: f.invoiceId } })).toBe(1);
  });

  it("a refund inside a bigger action (early return) is held to the same limit for an admin, never for the owner", async () => {
    await expect(assertRefundWithinLimit(adminId, 4_999)).resolves.toBeUndefined();
    await expect(assertRefundWithinLimit(adminId, 5_000)).rejects.toThrow(/over your refund limit/);
    await expect(assertRefundWithinLimit(ownerId, 500_000)).resolves.toBeUndefined();
  });

  it("approving sends one refund to Stripe, as the owner with the requester named; a double click cannot send two", async () => {
    const f = await fixture();
    const id = request(await submitInvoiceRefund(adminId, { invoiceId: f.invoiceId, amountCents: 7_000, reason: "GOODWILL", notes: "customer upset" }));
    const results = await Promise.allSettled([decideApproval(ownerId, id, "APPROVE"), decideApproval(ownerId, id, "APPROVE")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect(mocks.refundCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 7_000 }), expect.any(Object));
    const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
    expect(req.status).toBe("APPROVED");
    expect(req.executedAt).not.toBeNull();
    const refund = await prisma.refund.findFirstOrThrow({ where: { invoiceId: f.invoiceId } });
    expect(refund.authorizedByUserId).toBe(ownerId);
    expect(refund.notes).toMatch(/requested by Money Admin, approved by the owner/);
    await expect(decideApproval(ownerId, id, "APPROVE")).rejects.toThrow(/already decided/);
  });

  it("a Stripe failure after approval is shown, never reported as done, and the approval is not re-run", async () => {
    const f = await fixture();
    const id = request(await submitInvoiceRefund(adminId, { invoiceId: f.invoiceId, amountCents: 6_000, reason: "GOODWILL", notes: "stripe down" }));
    mocks.refundCreate.mockRejectedValue({ type: "StripeConnectionError", message: "simulated connection loss" });
    const result = await decideApproval(ownerId, id, "APPROVE");
    expect(result.status).toBe("APPROVED");
    expect(result.message).not.toMatch(/Stripe confirmed|Approved and done/);
    expect(result.message).toMatch(/not finished yet/);
    expect(result.message).toMatch(/Waiting for Stripe/);
    const waiting = await prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
    expect(waiting.executedAt).toBeNull(); // not finished until Stripe confirms
    expect(waiting.resultRef).toMatch(/^op:/);
    const shown = (await listDecidedApprovals()).find((r) => r.id === id)!;
    expect(shown.finished).toBe(false);
    expect(shown.stateNote).toMatch(/Waiting for Stripe/);
    expect(shown.canFinish).toBe(false); // Stripe's own recovery owns it; no second send is offered
    const op = await prisma.providerOperation.findFirstOrThrow({ where: { subjectType: "Refund", subjectId: (await prisma.refund.findFirstOrThrow({ where: { invoiceId: f.invoiceId } })).id } });
    expect(["UNKNOWN", "PENDING", "FAILED"]).toContain(op.status);
    mocks.refundCreate.mockClear();
    await expect(decideApproval(ownerId, id, "APPROVE")).rejects.toThrow(/already decided/);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
  });

  it("an approval interrupted before anything was sent can be checked and finished: it sends once, and not before two minutes", async () => {
    const f = await fixture();
    const id = request(await submitInvoiceRefund(adminId, { invoiceId: f.invoiceId, amountCents: 6_500, reason: "GOODWILL", notes: "interrupted" }));
    // The server stopped right after the yes was recorded: approved, nothing sent.
    await prisma.approvalRequest.update({ where: { id }, data: { status: "APPROVED", decidedByUserId: ownerId, decidedAt: new Date() } });
    await expect(finishApprovedRequest(ownerId, id)).rejects.toThrow(/moments ago/);
    await prisma.approvalRequest.update({ where: { id }, data: { decidedAt: new Date(Date.now() - 300_000) } });
    const results = await Promise.allSettled([finishApprovedRequest(ownerId, id), finishApprovedRequest(ownerId, id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).executedAt).not.toBeNull();
    expect(await prisma.refund.count({ where: { invoiceId: f.invoiceId } })).toBe(1);
  });

  it("finishing finds the refund an interrupted approval already made and never sends the money again", async () => {
    const f = await fixture();
    const id = request(await submitInvoiceRefund(adminId, { invoiceId: f.invoiceId, amountCents: 6_600, reason: "GOODWILL", notes: "half done" }));
    await decideApproval(ownerId, id, "APPROVE");
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    // Pretend the server stopped before it recorded the result.
    await prisma.approvalRequest.update({ where: { id }, data: { executedAt: null, resultRef: null, decidedAt: new Date(Date.now() - 300_000) } });
    mocks.refundCreate.mockClear();
    const out = await finishApprovedRequest(ownerId, id);
    expect(out.status).toBe("APPROVED");
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    expect(await prisma.refund.count({ where: { invoiceId: f.invoiceId } })).toBe(1);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).executedAt).not.toBeNull();
  });

  it("stale input fails safely: refunding more than was paid is refused at approval time and recorded as failed", async () => {
    const f = await fixture();
    const id = request(await submitInvoiceRefund(adminId, { invoiceId: f.invoiceId, amountCents: 9_000, reason: "GOODWILL", notes: "first" }));
    // Meanwhile the owner refunds most of the invoice directly.
    await submitInvoiceRefund(ownerId, { invoiceId: f.invoiceId, amountCents: 15_000, reason: "GOODWILL", notes: "owner did it" });
    mocks.refundCreate.mockClear();
    const result = await decideApproval(ownerId, id, "APPROVE");
    expect(result.status).toBe("FAILED");
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
    expect(req.status).toBe("FAILED");
    expect(req.failureMessage).toBeTruthy();
  });

  it("the owner never waits; a limited admin cannot even ask; declined and expired requests send nothing", async () => {
    const f = await fixture();
    expect((await submitInvoiceRefund(ownerId, { invoiceId: f.invoiceId, amountCents: 8_000, reason: "GOODWILL", notes: "owner refund" })).status).toBe("DONE");
    await prisma.staffCapabilityOverride.create({ data: { userId: adminId, capability: "ISSUE_REFUND", allowed: false, updatedByUserId: ownerId } });
    await expect(submitInvoiceRefund(adminId, { invoiceId: f.invoiceId, amountCents: 6_000, reason: "GOODWILL", notes: "limited" })).rejects.toThrow(/permission/);
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: adminId } });

    mocks.refundCreate.mockClear();
    const a = request(await submitInvoiceRefund(adminId, { invoiceId: f.invoiceId, amountCents: 6_000, reason: "GOODWILL", notes: "decline me" }));
    expect((await decideApproval(ownerId, a, "DECLINE", "no")).status).toBe("DECLINED");
    const b = request(await submitInvoiceRefund(adminId, { invoiceId: f.invoiceId, amountCents: 6_100, reason: "GOODWILL", notes: "too slow" }));
    await prisma.approvalRequest.update({ where: { id: b }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await decideApproval(ownerId, b, "APPROVE")).status).toBe("EXPIRED");
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    await expect(decideApproval(adminId, a, "APPROVE")).rejects.toThrow();
  });

  it("keeping part of a deposit at or above the limit waits; approving records the decision once with one Stripe refund", async () => {
    const f = await fixture();
    const sent = await submitDepositDecision(adminId, { depositId: f.depositId, refundCents: 12_000, deductionReason: "Scratched door" });
    expect(sent.status).toBe("SENT_FOR_APPROVAL");
    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: f.depositId } })).refundedAt).toBeNull();
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    const result = await decideApproval(ownerId, request(sent), "APPROVE");
    expect(result.status).toBe("APPROVED");
    const dep = await prisma.deposit.findUniqueOrThrow({ where: { id: f.depositId } });
    expect(dep.refundedAmountCents).toBe(12_000);
    expect(dep.refundedByUserId).toBe(ownerId);
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
  });

  it("the owner's deposit decision acts at once, and a large refund (small keep) still waits under the refund limit", async () => {
    const f = await fixture();
    const sent = await submitDepositDecision(adminId, { depositId: f.depositId, refundCents: 17_000, deductionReason: "Small mark" });
    expect(sent.status).toBe("SENT_FOR_APPROVAL");
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request(sent) } })).kind).toBe("REFUND");
    const g = await fixture();
    expect((await submitDepositDecision(ownerId, { depositId: g.depositId, refundCents: 20_000 })).status).toBe("DONE");
  });

  it("a held payment refund waits at or above the limit and sends one refund when approved", async () => {
    const f = await fixture({ held: true });
    const sent = await submitHeldPaymentRefund(adminId, f.paymentId);
    expect(sent.status).toBe("SENT_FOR_APPROVAL");
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    const result = await decideApproval(ownerId, request(sent), "APPROVE");
    expect(result.status).toBe("APPROVED");
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: f.paymentId } })).status).not.toBe("held");
  });

  it("a slow original run and a recovery run of the same approval can never make two refunds", async () => {
    const f = await fixture();
    const id = request(await submitInvoiceRefund(adminId, { invoiceId: f.invoiceId, amountCents: 6_700, reason: "GOODWILL", notes: "slow" }));
    await decideApproval(ownerId, id, "APPROVE");
    expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
    // The original is "still alive" from the page's view, yet recovery runs: it must find the same refund, not make another.
    await prisma.approvalRequest.update({ where: { id }, data: { status: "APPROVED", executedAt: null, resultRef: null, decidedAt: new Date(Date.now() - 300_000) } });
    await prisma.refund.updateMany({ where: { invoiceId: f.invoiceId }, data: { stripeRefundId: null } });
    mocks.refundCreate.mockClear();
    await finishApprovedRequest(ownerId, id);
    expect(await prisma.refund.count({ where: { invoiceId: f.invoiceId } })).toBe(1);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
  });

  it("finishing a deposit approval after the owner settled it a different way reports that instead of calling it done", async () => {
    const f = await fixture();
    const id = request(await submitDepositDecision(adminId, { depositId: f.depositId, refundCents: 12_000, deductionReason: "Scratched door" }));
    await prisma.approvalRequest.update({ where: { id }, data: { status: "APPROVED", decidedByUserId: ownerId, decidedAt: new Date(Date.now() - 300_000) } });
    await prisma.deposit.update({ where: { id: f.depositId }, data: { refundedAt: new Date(), refundedAmountCents: 9_000, deductionReason: "Other" } });
    const out = await finishApprovedRequest(ownerId, id);
    expect(out.status).toBe("FAILED");
    expect(out.message).toMatch(/different way/);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
  });

  it("finishing a held-payment approval that was dealt with another way reports that, and sends nothing", async () => {
    const f = await fixture({ held: true });
    const id = request(await submitHeldPaymentRefund(adminId, f.paymentId));
    await prisma.approvalRequest.update({ where: { id }, data: { status: "APPROVED", decidedByUserId: ownerId, decidedAt: new Date(Date.now() - 300_000) } });
    await prisma.payment.update({ where: { id: f.paymentId }, data: { status: "held_to_credit" } }); // someone made it credit meanwhile
    const out = await finishApprovedRequest(ownerId, id);
    expect(out.status).toBe("FAILED");
    expect(out.message).toMatch(/another way/);
    expect(mocks.refundCreate).not.toHaveBeenCalled();
  });

  it("applying a customer credit above the limit waits, then applies once inside the approval", async () => {
    const f = await fixture({ source: "MANUAL" });
    await prisma.invoice.update({ where: { id: f.invoiceId }, data: { status: "OPEN", amountPaidCents: 0 } });
    const credit = await prisma.customerCredit.create({ data: { customerId: f.customerId, amountCents: 9_000, remainingCents: 9_000, sourceType: "MANUAL", sourceId: `am-${tag}`, reason: "test credit" } });
    const sent = await submitCreditApply(adminId, { creditId: credit.id, invoiceId: f.invoiceId, amountCents: 6_000 });
    expect(sent.status).toBe("SENT_FOR_APPROVAL");
    expect((await prisma.customerCredit.findUniqueOrThrow({ where: { id: credit.id } })).remainingCents).toBe(9_000);
    const results = await Promise.allSettled([decideApproval(ownerId, request(sent), "APPROVE"), decideApproval(ownerId, request(sent), "APPROVE")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.customerCredit.findUniqueOrThrow({ where: { id: credit.id } })).remainingCents).toBe(3_000);
    expect((await submitCreditApply(adminId, { creditId: credit.id, invoiceId: f.invoiceId, amountCents: 2_000 })).status).toBe("DONE");
  });
});
