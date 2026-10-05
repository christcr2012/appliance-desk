import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  decide: vi.fn(),
  refund: vi.fn(),
  credit: vi.fn(),
  prisma: { providerOperation: { findUnique: vi.fn() }, invoice: { findUnique: vi.fn() } },
}));

vi.mock("@/lib/session", () => ({ requireRole: m.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: m.prisma }));
vi.mock("@/domains/billing/refunds", () => ({ decideDepositRefund: m.decide, issueInvoiceRefund: m.refund }));
vi.mock("@/domains/billing/money-decisions", () => ({ applyCreditDecision: m.credit, getSpendableCredits: vi.fn() }));

import { applyCreditAction, decideDepositAction, refundInvoiceAction } from "@/app/desk/billing/money-actions";

// A signed-in STAFF member: requireRole("OWNER","ADMIN") sends them away (it throws a redirect).
function asStaff() {
  m.requireRole.mockImplementation(async (...roles: string[]) => {
    if (!roles.includes("STAFF")) throw new Error("NEXT_REDIRECT");
    return { user: { id: "staff", role: "STAFF" } };
  });
}
function asOwner() {
  m.requireRole.mockResolvedValue({ user: { id: "owner", role: "OWNER" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.invoice.findUnique.mockResolvedValue({ customerId: "c1" });
});

describe("money decisions are owner/admin only", () => {
  it("staff are turned away from every money action before anything runs", async () => {
    asStaff();
    await expect(decideDepositAction("d1", { amountCents: 100, reason: "", confirmed: true })).rejects.toThrow("NEXT_REDIRECT");
    await expect(refundInvoiceAction("i1", { amountCents: 100, reason: "why", select: "OTHER", confirmed: true })).rejects.toThrow("NEXT_REDIRECT");
    await expect(applyCreditAction("i1", { amountCents: 100, select: "cr1", confirmed: true })).rejects.toThrow("NEXT_REDIRECT");
    expect(m.decide).not.toHaveBeenCalled();
    expect(m.refund).not.toHaveBeenCalled();
    expect(m.credit).not.toHaveBeenCalled();
  });

  it("each action asks for exactly owner and admin", async () => {
    asOwner();
    m.decide.mockResolvedValue({ providerOpId: null });
    m.refund.mockResolvedValue({ refundId: "r", providerOpId: null });
    m.credit.mockResolvedValue(undefined);
    await decideDepositAction("d1", { amountCents: 100, reason: "", confirmed: true });
    await refundInvoiceAction("i1", { amountCents: 100, reason: "why", select: "OTHER", confirmed: true });
    await applyCreditAction("i1", { amountCents: 100, select: "cr1", confirmed: true });
    expect(m.requireRole.mock.calls).toEqual([["OWNER", "ADMIN"], ["OWNER", "ADMIN"], ["OWNER", "ADMIN"]]);
  });
});

describe("the decision forms refuse bad input before calling the money code", () => {
  beforeEach(asOwner);
  it("needs a whole positive number of cents and the confirmation box", async () => {
    for (const cents of [0, -5, 1.5, Number.NaN]) {
      expect((await decideDepositAction("d1", { amountCents: cents, reason: "", confirmed: true })).status).toBe("error");
    }
    expect((await decideDepositAction("d1", { amountCents: 100, reason: "", confirmed: false })).status).toBe("error");
    expect((await applyCreditAction("i1", { amountCents: 100, select: "cr1", confirmed: false })).status).toBe("error");
    expect((await applyCreditAction("i1", { amountCents: 100, select: "", confirmed: true })).status).toBe("error");
    expect(m.decide).not.toHaveBeenCalled();
    expect(m.credit).not.toHaveBeenCalled();
  });
  it("a refund needs a reason from the list and a written note", async () => {
    expect((await refundInvoiceAction("i1", { amountCents: 100, reason: "why", select: "NOPE", confirmed: true })).status).toBe("error");
    expect((await refundInvoiceAction("i1", { amountCents: 100, reason: " ", select: "OTHER", confirmed: true })).status).toBe("error");
    expect(m.refund).not.toHaveBeenCalled();
  });
  it("shows the money code's plain sentence but never a database or internal error", async () => {
    m.refund.mockRejectedValueOnce(new Error("Refund amount exceeds what can still be refunded on this invoice."));
    const plain = await refundInvoiceAction("i1", { amountCents: 100, reason: "why", select: "OTHER", confirmed: true });
    expect(plain).toEqual({ status: "error", message: "Refund amount exceeds what can still be refunded on this invoice." });
    m.refund.mockRejectedValueOnce(new Error("Invalid `prisma.refund.create()` invocation: constraint failed refund"));
    const hidden = await refundInvoiceAction("i1", { amountCents: 100, reason: "why", select: "OTHER", confirmed: true });
    expect(hidden.status).toBe("error");
    expect(hidden.message).not.toMatch(/prisma|constraint/i);
  });
  it("tells the owner what state the Stripe request is in", async () => {
    m.refund.mockResolvedValue({ refundId: "r", providerOpId: "op1" });
    m.prisma.providerOperation.findUnique.mockResolvedValue({ status: "UNKNOWN" });
    const result = await refundInvoiceAction("i1", { amountCents: 100, reason: "why", select: "OTHER", confirmed: true });
    expect(result.status).toBe("success");
    expect(result.message).toMatch(/did not get an answer from Stripe/);
  });
});
