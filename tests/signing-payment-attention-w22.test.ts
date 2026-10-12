import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  findMany: vi.fn(), count: vi.fn(), requireRole: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  agreementSigningPayment: { findMany: f.findMany, count: f.count },
} }));
vi.mock("@/lib/session", () => ({ requireRole: f.requireRole }));
import { listSigningPaymentAttention, signingPaymentDueItem } from "@/domains/exceptions/signing-payment-attention";
const signedAt = new Date("2026-10-12T12:30:00.000Z");
const sample = (id: string, cents = 3500) => ({
  agreementId: id, totalCents: cents, signedAt,
  agreement: { customer: { user: { name: "Taylor Customer", email: "t@example.test" } } },
});
beforeEach(() => {
  Object.values(f).forEach(mock => mock.mockReset());
  f.requireRole.mockResolvedValue({ user: { role: "OWNER" } });
  f.findMany.mockResolvedValue([]);
  f.count.mockResolvedValue(0);
});
describe("W-22 signing payment To do", () => {
  it("maps a real unpaid obligation into a stable agreement action, never a payment receipt", () => {
    const item = signingPaymentDueItem({ agreementId: "agr-123", totalCents: 3500, signedAt, customerName: "Taylor" });
    expect(item).toMatchObject({category:"SIGNING_PAYMENT_DUE", severity:"medium", amountCents:3500,
      href:"/desk/agreements/agr-123", primaryAction:{href:"/desk/agreements/agr-123",label:"Review signing payment"}, since:signedAt});
    expect(item.detail).toContain("has not been recorded as paid");
    expect(item.dueOn).toBeUndefined();
    expect(() => signingPaymentDueItem({agreementId:"a",totalCents:0,signedAt,customerName:"T"})).toThrow();
  });
  it("loads positive unpaid rows oldest first, never settled or waived", async () => {
    f.findMany.mockResolvedValue([sample("agr-123"), sample("agr-456", 7200)]);
    const result = await listSigningPaymentAttention(50);
    expect(f.requireRole).toHaveBeenCalledWith("OWNER", "ADMIN");
    expect(f.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {status:"AWAITING_PAYMENT"},
      orderBy:[{signedAt:"asc"},{agreementId:"asc"}],take:50,
    }));
    expect(result.rows.map(x => x.amountCents)).toEqual([3500,7200]);
    expect(result.total).toBe(2);
    expect(f.count).not.toHaveBeenCalled();
  });
  it("reports truncation using a bounded count at the cap", async () => {
    f.findMany.mockResolvedValue([sample("agr-123")]);
    f.count.mockResolvedValue(4);
    const result=await listSigningPaymentAttention(1);
    expect(result.total).toBe(4);
    expect(result.rows).toHaveLength(1);
    expect(f.count).toHaveBeenCalledWith({where:{status:"AWAITING_PAYMENT"}});
  });
  it("denies staff before any database query and rejects unbounded requests", async () => {
    f.requireRole.mockRejectedValue(new Error("Forbidden"));
    await expect(listSigningPaymentAttention(50)).rejects.toThrow(/Forbidden/);
    expect(f.findMany).not.toHaveBeenCalled();
    f.requireRole.mockResolvedValue({user:{role:"OWNER"}});
    await expect(listSigningPaymentAttention(500)).rejects.toThrow(/bounded/);
    expect(f.findMany).not.toHaveBeenCalled();
  });
  it("uses customer email only when the display name is absent", async () => {
    f.findMany.mockResolvedValue([{
      ...sample("agr-123"), agreement:{customer:{user:{name:null,email:"fallback@example.test"}}},
    }]);
    expect((await listSigningPaymentAttention(50)).rows[0].title).toContain("fallback@example.test");
  });
});
