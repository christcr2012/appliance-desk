import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createExpense } from "@/domains/books/expenses";
import {
  countWaitingApprovals, decideApproval, listWaitingApprovals, saveApprovalLimits, submitExpensePost, submitWriteOff,
} from "@/domains/approvals";

// Batch O-3 on real Postgres: below the limit acts at once; above it waits; approve runs once as the owner;
// stale input fails safely; expiry; the owner never needs approval; nobody but the owner can decide.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("approval limits on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId: string;
  const adminId = `ap-admin-${tag}`;
  const customerUserId = `ap-cust-user-${tag}`;
  const customerId = `ap-cust-${tag}`;
  const invoices: string[] = [];
  let saved: { approvalThresholds: unknown; approvalExpiryDays: number };

  const invoice = async (due: number, paid = 0) => {
    const id = `ap-inv-${tag}-${invoices.length}`;
    await prisma.invoice.create({ data: { id, customerId, status: paid ? "PARTIALLY_PAID" : "OPEN", subtotalCents: due, amountDueCents: due, amountPaidCents: paid } });
    invoices.push(id);
    return id;
  };

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.user.createMany({ data: [
      { id: adminId, name: "Approval Admin", email: `${tag}-admin@example.test`, role: "ADMIN", emailVerified: true },
      { id: customerUserId, name: "Approval Customer", email: `${tag}-cust@example.test`, role: "CUSTOMER", emailVerified: true },
    ] });
    await prisma.customer.create({ data: { id: customerId, userId: customerUserId, referralCode: `A${tag}${randomUUID().slice(0, 6)}` } });
    saved = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { approvalThresholds: true, approvalExpiryDays: true } });
    await saveApprovalLimits(ownerId, { limitsCents: { WRITE_OFF: 5_000, EXPENSE: 25_000 }, expiryDays: 7 });
  });
  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { approvalThresholds: saved.approvalThresholds as object, approvalExpiryDays: saved.approvalExpiryDays } });
    await prisma.approvalRequest.deleteMany({ where: { requestedByUserId: adminId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: invoices } }, { userId: adminId }] } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoices } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, customerUserId] } } });
  });

  it("below the limit the admin acts at once; the owner never waits, even far above it", async () => {
    const small = await invoice(4_999);
    expect(await submitWriteOff(adminId, small, "uncollectible")).toEqual({ status: "DONE" });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: small } })).status).toBe("WRITTEN_OFF");
    const big = await invoice(900_000);
    expect(await submitWriteOff(ownerId, big, "uncollectible")).toEqual({ status: "DONE" });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: big } })).status).toBe("WRITTEN_OFF");
  });

  it("at or above the limit it waits: nothing changes, a second ask does not stack, and the owner sees one", async () => {
    const inv = await invoice(5_000);
    const first = await submitWriteOff(adminId, inv, "tenant vanished");
    expect(first.status).toBe("SENT_FOR_APPROVAL");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv } })).status).toBe("OPEN");
    expect((await submitWriteOff(adminId, inv, "again")).status).toBe("ALREADY_WAITING");
    expect(await prisma.approvalRequest.count({ where: { targetRef: inv } })).toBe(1);
    expect(await countWaitingApprovals()).toBeGreaterThanOrEqual(1);
    expect((await listWaitingApprovals()).some((r) => r.summary.includes("tenant vanished"))).toBe(true);
  });

  it("approving runs the write-off once, as the owner, with the requester named; a second decision is refused", async () => {
    const inv = await invoice(8_000);
    const sent = await submitWriteOff(adminId, inv, "customer closed account");
    if (sent.status === "DONE") throw new Error("expected a request");
    const done = await decideApproval(ownerId, sent.requestId, "APPROVE", "ok");
    expect(done.status).toBe("APPROVED");
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: inv } });
    expect(row.status).toBe("WRITTEN_OFF");
    expect(row.writtenOffReason).toMatch(/requested by Approval Admin, approved by the owner/);
    const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: sent.requestId } });
    expect(req.status).toBe("APPROVED");
    expect(req.decidedByUserId).toBe(ownerId);
    expect(req.executedAt).not.toBeNull();
    await expect(decideApproval(ownerId, sent.requestId, "APPROVE")).rejects.toThrow(/already decided/);
    expect(await prisma.auditLog.count({ where: { entityId: inv, action: "billing.invoice_written_off" } })).toBe(1);
  });

  it("two owners approving at the same moment write off exactly once", async () => {
    const inv = await invoice(9_000);
    const sent = await submitWriteOff(adminId, inv, "race");
    if (sent.status === "DONE") throw new Error("expected a request");
    const results = await Promise.allSettled([
      decideApproval(ownerId, sent.requestId, "APPROVE"),
      decideApproval(ownerId, sent.requestId, "APPROVE"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: inv, action: "billing.invoice_written_off" } })).toBe(1);
  });

  it("stale input fails safely: an invoice paid in the meantime is not written off and the request is marked failed", async () => {
    const inv = await invoice(7_000);
    const sent = await submitWriteOff(adminId, inv, "will be paid");
    if (sent.status === "DONE") throw new Error("expected a request");
    await prisma.invoice.update({ where: { id: inv }, data: { status: "PAID", amountPaidCents: 7_000 } });
    const result = await decideApproval(ownerId, sent.requestId, "APPROVE");
    expect(result.status).toBe("FAILED");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv } })).status).toBe("PAID");
    const req = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: sent.requestId } });
    expect(req.status).toBe("FAILED");
    expect(req.failureMessage).toMatch(/already fully paid/);
  });

  it("decline changes nothing; an expired request cannot be approved", async () => {
    const a = await invoice(6_000);
    const sentA = await submitWriteOff(adminId, a, "decline me");
    if (sentA.status === "DONE") throw new Error("expected a request");
    expect((await decideApproval(ownerId, sentA.requestId, "DECLINE", "no")).status).toBe("DECLINED");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: a } })).status).toBe("OPEN");

    const b = await invoice(6_000);
    const sentB = await submitWriteOff(adminId, b, "too slow");
    if (sentB.status === "DONE") throw new Error("expected a request");
    await prisma.approvalRequest.update({ where: { id: sentB.requestId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await decideApproval(ownerId, sentB.requestId, "APPROVE")).status).toBe("EXPIRED");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: b } })).status).toBe("OPEN");
  });

  it("only the active owner can decide, and a limited admin cannot even ask", async () => {
    const inv = await invoice(6_500);
    const sent = await submitWriteOff(adminId, inv, "admin decides?");
    if (sent.status === "DONE") throw new Error("expected a request");
    await expect(decideApproval(adminId, sent.requestId, "APPROVE")).rejects.toThrow();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv } })).status).toBe("OPEN");
    await prisma.staffCapabilityOverride.create({ data: { userId: adminId, capability: "WRITE_OFF", allowed: false, updatedByUserId: ownerId } });
    const other = await invoice(6_500);
    await expect(submitWriteOff(adminId, other, "limited")).rejects.toThrow(/permission/);
    await prisma.staffCapabilityOverride.delete({ where: { userId_capability: { userId: adminId, capability: "WRITE_OFF" } } });
  });

  it("an expense at or above the limit waits for approval and nothing is posted; a declined one stays unposted", async () => {
    const category = await prisma.expenseCategory.findFirstOrThrow({ where: { active: true } });
    const bank = await prisma.ledgerAccount.findUniqueOrThrow({ where: { systemRole: "BANK" } });
    const created = await createExpense(adminId, {
      date: "2026-10-17", amountCents: 30_000, vendorTaxCents: 0, vendorName: "Approval vendor",
      categoryId: category.id, paidFromAccountId: bank.id, memo: "approval test",
    }, "SUBMITTED");
    const expense = await prisma.expense.findUniqueOrThrow({ where: { id: created.id } });
    try {
      const sent = await submitExpensePost(adminId, expense.id, expense.version);
      if (sent.status === "DONE") throw new Error("expected a request");
      expect((await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } })).status).toBe("SUBMITTED");
      expect((await decideApproval(ownerId, sent.requestId, "DECLINE")).status).toBe("DECLINED");
      expect((await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } })).status).toBe("SUBMITTED");
    } finally {
      await prisma.approvalRequest.deleteMany({ where: { targetRef: expense.id } });
      await prisma.expense.delete({ where: { id: expense.id } }).catch(() => undefined);
    }
  });

  it("limits are validated and audited, and only the owner saves them", async () => {
    await expect(saveApprovalLimits(ownerId, { limitsCents: { WRITE_OFF: 50 }, expiryDays: 7 })).rejects.toThrow(/between/);
    await expect(saveApprovalLimits(ownerId, { limitsCents: {}, expiryDays: 0 })).rejects.toThrow(/1 and 30/);
    await expect(saveApprovalLimits(adminId, { limitsCents: {}, expiryDays: 7 })).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { action: "settings.approval_limits", userId: ownerId } })).toBeGreaterThanOrEqual(1);
  });
});
