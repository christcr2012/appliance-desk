import { describe, expect, it, vi } from "vitest";

const leadUpdateMany = vi.fn();
const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({ lead: { updateMany: (args: unknown) => leadUpdateMany(args) } }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (callback: (tx: unknown) => Promise<unknown>) => transaction(callback),
  },
}));

import {
  recordLeadMessageContactInTx,
  recordRealContact,
  recordRealContactInTx,
} from "@/domains/leads/contact";

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
    const tx = { lead: { updateMany: (args: unknown) => leadUpdateMany(args) } } as never;
    leadUpdateMany.mockClear().mockResolvedValue({ count: 1 });
    const when = new Date("2026-10-05T19:00:00Z");

    expect(
      await recordLeadMessageContactInTx(
        tx,
        { recipientType: "Staff", recipientId: "lead-1" },
        when,
      ),
    ).toBe(false);
    expect(leadUpdateMany).not.toHaveBeenCalled();

    expect(
      await recordLeadMessageContactInTx(
        tx,
        { recipientType: "Lead", recipientId: "lead-1" },
        when,
      ),
    ).toBe(true);
    expect(leadUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("returns false when an older replay cannot advance the timestamp", async () => {
    const tx = { lead: { updateMany: (args: unknown) => leadUpdateMany(args) } } as never;
    leadUpdateMany.mockResolvedValueOnce({ count: 0 });
    expect(await recordRealContactInTx(tx, "lead-1", new Date("2026-09-01"))).toBe(false);
  });
});
