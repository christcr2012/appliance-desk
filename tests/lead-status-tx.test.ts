import { describe, expect, it, vi, beforeEach } from "vitest";

// LD-1: updateLeadStatus is one transaction — lock, actor re-check, status +
// follow-up in one update, first contact, audit. The fakes below provide the
// same tx calls the real function makes (AGENTS.md section 4).
let lockedRow: {
  id: string;
  status: string;
  contactName: string;
  assignedToUserId: string | null;
  mergedIntoLeadId: string | null;
} = { id: "lead-1", status: "NEW", contactName: "Ada", assignedToUserId: null, mergedIntoLeadId: null };
let actorRow: { id: string; role: string; archivedAt: Date | null } = {
  id: "owner-1",
  role: "OWNER",
  archivedAt: null,
};
const mergedTargetName = "Kept Person";

const queryRaw = vi.fn();
const leadUpdate = vi.fn();
const leadFindUnique = vi.fn();
const userFindUnique = vi.fn();
const executeRaw = vi.fn();
const auditCreate = vi.fn();
const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    lead: { update: (args: unknown) => leadUpdate(args), findUnique: (args: unknown) => leadFindUnique(args) },
    user: { findUnique: (args: unknown) => userFindUnique(args) },
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    auditLog: { create: (args: unknown) => auditCreate(args) },
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (callback: (tx: unknown) => Promise<unknown>) => transaction(callback),
  },
}));

import { updateLeadStatus } from "@/domains/leads";

const followUp = new Date("2026-01-10T00:00:00Z");

beforeEach(() => {
  lockedRow = { id: "lead-1", status: "NEW", contactName: "Ada", assignedToUserId: null, mergedIntoLeadId: null };
  actorRow = { id: "owner-1", role: "OWNER", archivedAt: null };
  queryRaw.mockClear().mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes('FROM "Lead"')) return [lockedRow];
    return [];
  });
  leadFindUnique.mockClear().mockImplementation(async () => ({ contactName: mergedTargetName }));
  userFindUnique.mockClear().mockImplementation(async () => actorRow);
  executeRaw.mockClear().mockResolvedValue(1);
  auditCreate.mockClear().mockResolvedValue({});
  leadUpdate.mockReset().mockResolvedValue({
    id: "lead-1",
    status: "CONTACTED",
    lostReason: null,
    nextFollowUpOn: followUp,
  });
  transaction.mockClear();
});

describe("updateLeadStatus in one transaction", () => {
  it("NEW to CONTACTED sets the follow-up, marks first contact, and audits once", async () => {
    const updated = await updateLeadStatus("owner-1", "lead-1", "CONTACTED", undefined, followUp);
    expect(updated.status).toBe("CONTACTED");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { status: "CONTACTED", lostReason: null, nextFollowUpOn: followUp },
    });
    // First contact: the raw UPDATE runs, then the audit.
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "lead.status",
        entityType: "Lead",
        entityId: "lead-1",
        oldValue: { status: "NEW" },
        newValue: { status: "CONTACTED", nextFollowUpOn: followUp.toISOString() },
      }),
    });
  });

  it("LOST clears the follow-up, keeps the reason, and never marks first contact", async () => {
    leadUpdate.mockResolvedValue({
      id: "lead-1",
      status: "LOST",
      lostReason: "No longer needed",
      nextFollowUpOn: null,
    });
    await updateLeadStatus("owner-1", "lead-1", "LOST", "No longer needed");
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { status: "LOST", lostReason: "No longer needed", nextFollowUpOn: null },
    });
    expect(executeRaw).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        newValue: { status: "LOST", lostReason: "No longer needed", nextFollowUpOn: null },
      }),
    });
  });

  it("LOST without a reason is refused before touching the database", async () => {
    await expect(updateLeadStatus("owner-1", "lead-1", "LOST", "  ")).rejects.toThrow(
      /Give a reason/,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("a merged lead is refused with the merged message", async () => {
    lockedRow = { ...lockedRow, mergedIntoLeadId: "lead-keep" };
    await expect(updateLeadStatus("owner-1", "lead-1", "CONTACTED")).rejects.toThrow(
      /merged into Kept Person/,
    );
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it("a converted lead is refused", async () => {
    lockedRow = { ...lockedRow, status: "CONVERTED" };
    await expect(updateLeadStatus("owner-1", "lead-1", "CONTACTED")).rejects.toThrow(
      /already been converted/,
    );
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it("a staff actor with the Leads screen can change a status", async () => {
    actorRow = { id: "staff-1", role: "STAFF", archivedAt: null };
    const updated = await updateLeadStatus("staff-1", "lead-1", "CONTACTED", undefined, followUp);
    expect(updated.status).toBe("CONTACTED");
    expect(leadUpdate).toHaveBeenCalled();
  });

  it("a customer is refused", async () => {
    actorRow = { id: "cust-1", role: "CUSTOMER", archivedAt: null };
    await expect(updateLeadStatus("cust-1", "lead-1", "CONTACTED")).rejects.toThrow(
      /no longer has access/,
    );
    expect(leadUpdate).not.toHaveBeenCalled();
  });
});
