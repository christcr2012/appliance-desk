import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), claim: vi.fn(), audit: vi.fn(), tx: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: m.guard }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.tx } }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/domains/leads", () => ({}));
import { addLeadEmailAction } from "@/app/desk/leads/actions";
beforeEach(() => {
  vi.clearAllMocks();
  m.guard.mockResolvedValue({ user: { id: "owner" } });
  m.claim.mockResolvedValue({ count: 1 });
  m.audit.mockResolvedValue({});
  m.tx.mockImplementation(callback => callback({ lead: { updateMany: m.claim }, auditLog: { create: m.audit } }));
});
it("saves a missing normalized email and its audit together", async () => {
  expect(await addLeadEmailAction("l1", " Customer@Example.com ")).toEqual({ status: "success" });
  expect(m.claim).toHaveBeenCalledWith({ where: { id: "l1", status: { not: "CONVERTED" }, OR: [{ email: null }, { email: "" }] }, data: { email: "customer@example.com" } });
  expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "owner", entityId: "l1", newValue: { email: "customer@example.com" } }) });
});
it("rejects invalid input before database writes", async () => {
  expect(await addLeadEmailAction("l1", "invalid")).toMatchObject({ status: "error" });
  expect(m.tx).not.toHaveBeenCalled();
});
it("cannot overwrite another email or a converted lead", async () => {
  m.claim.mockResolvedValue({ count: 0 });
  expect(await addLeadEmailAction("l1", "a@example.com")).toMatchObject({ status: "error" });
  expect(m.audit).not.toHaveBeenCalled();
  expect(m.revalidate).not.toHaveBeenCalled();
});
it("reports an audit failure without refreshing as though saved", async () => {
  m.audit.mockRejectedValueOnce(new Error("audit failed"));
  expect(await addLeadEmailAction("l1", "a@example.com")).toMatchObject({ status: "error" });
  expect(m.revalidate).not.toHaveBeenCalled();
});
it("denies staff before any write", async () => {
  m.guard.mockRejectedValueOnce(new Error("denied"));
  await expect(addLeadEmailAction("l1", "a@example.com")).rejects.toThrow("denied");
  expect(m.tx).not.toHaveBeenCalled();
});
