import { describe, expect, it, vi } from "vitest";

const leadUpdateMany = vi.fn();
const executeRaw = vi.fn();
const auditCreate = vi.fn();
const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    lead: { updateMany: (args: unknown) => leadUpdateMany(args) },
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    auditLog: { create: (args: unknown) => auditCreate(args) },
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (callback: (tx: unknown) => Promise<unknown>) => transaction(callback),
  },
}));

import {
  markFirstContactInTx,
  recordLeadMessageContactInTx,
  recordRealContact,
  recordRealContactInTx,
} from "@/domains/leads/contact";

const fakeTx = {
  lead: { updateMany: (args: unknown) => leadUpdateMany(args) },
  $executeRaw: (...args: unknown[]) => executeRaw(...args),
  auditLog: { create: (args: unknown) => auditCreate(args) },
} as never;

describe("lead real-contact evidence", () => {
  it("updates monotonically rather than using generic Lead.updatedAt", async () => {
    leadUpdateMany.mockResolvedValueOnce({ count: 1 });
    const when = new Date("2026-10-05T18:00:00Z");
    expect(await recordRealContact("lead-1", when)).toBe(true);
    expect(leadUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "lead-1",
        OR: [{ lastRealContactAt: null }, { lastRealContactAt: { lt: when } }],
      },
      data: { lastRealContactAt: when },
    });
  });

  it("counts only messages whose recipient is the lead", async () => {
    const tx = fakeTx;
    leadUpdateMany.mockClear().mockResolvedValue({ count: 1 });
    executeRaw.mockClear().mockResolvedValue(1);
    auditCreate.mockClear().mockResolvedValue({});
    const when = new Date("2026-10-05T19:00:00Z");

    expect(
      await recordLeadMessageContactInTx(
        tx,
        { recipientType: "Staff", recipientId: "lead-1" },
        when,
      ),
    ).toBe(false);
    expect(leadUpdateMany).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();

    expect(
      await recordLeadMessageContactInTx(
        tx,
        { recipientType: "Lead", recipientId: "lead-1" },
        when,
      ),
    ).toBe(true);
    expect(leadUpdateMany).toHaveBeenCalledTimes(1);
    // The accepted message is also the lead's first contact.
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "lead.first_contact",
        entityType: "Lead",
        entityId: "lead-1",
      }),
    });
  });

  it("returns false when an older replay cannot advance the timestamp", async () => {
    const tx = fakeTx;
    leadUpdateMany.mockResolvedValueOnce({ count: 0 });
    expect(await recordRealContactInTx(tx, "lead-1", new Date("2026-09-01"))).toBe(false);
  });

  it("marks first contact once: only when firstContactedAt is still null", async () => {
    executeRaw.mockClear().mockResolvedValueOnce(1);
    auditCreate.mockClear().mockResolvedValue({});
    const when = new Date("2026-10-05T20:00:00Z");
    expect(await markFirstContactInTx(fakeTx, "lead-1", when)).toBe(true);
    // One statement: sets firstContactedAt only when null, and moves NEW to CONTACTED.
    const sql = String(executeRaw.mock.calls[0]?.[0]);
    expect(sql).toMatch(/firstContactedAt/);
    expect(sql).toMatch(/CASE WHEN "status" = 'NEW' THEN 'CONTACTED'/);
    expect(sql).toMatch(/"firstContactedAt" IS NULL/);
    expect(auditCreate).toHaveBeenCalledTimes(1);

    executeRaw.mockClear().mockResolvedValueOnce(0);
    auditCreate.mockClear();
    expect(await markFirstContactInTx(fakeTx, "lead-1", when)).toBe(false);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
