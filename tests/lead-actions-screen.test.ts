import { beforeEach, describe, expect, it, vi } from "vitest";

// LD-1 review fix: the lead actions check the actor's Leads screen
// directly. The job-role check inside requireRole looks at the address the
// request was posted from, and a server action can be posted to any page
// address, so a job role without Leads must be refused here — before any
// domain function runs — no matter which page the request claims to be on.

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  jobRoleScreens: vi.fn(),
  updateLeadStatus: vi.fn(),
  convertLeadToCustomer: vi.fn(),
  createLeadManually: vi.fn(),
  addLeadNote: vi.fn(),
  logLeadContact: vi.fn(),
  recordRealContact: vi.fn(),
  tx: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/job-role-guard", () => ({
  jobRoleScreens: m.jobRoleScreens,
  // Mirrors the real error (same name and message) for the assertions below.
  JobRoleScreenError: class JobRoleScreenError extends Error {
    constructor() {
      super("Your job role does not include this screen. Ask the owner if you need it.");
      this.name = "JobRoleScreenError";
    }
  },
}));
vi.mock("@/domains/leads", () => ({
  updateLeadStatus: m.updateLeadStatus,
  convertLeadToCustomer: m.convertLeadToCustomer,
  createLeadManually: m.createLeadManually,
  addLeadNote: m.addLeadNote,
  logLeadContact: m.logLeadContact,
}));
vi.mock("@/domains/leads/contact", () => ({ recordRealContact: m.recordRealContact }));
vi.mock("@/domains/leads/follow-up", () => ({
  parseFollowUpKey: () => new Date("2026-02-01T00:00:00Z"),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.tx } }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));

import {
  updateLeadStatusAction,
  createLeadAction,
  convertLeadAction,
  addLeadNoteAction,
  logLeadContactAction,
  addLeadEmailAction,
} from "@/app/desk/leads/actions";

const staff = { user: { id: "staff-1", role: "STAFF" } };

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue(staff);
  m.updateLeadStatus.mockResolvedValue({});
  m.createLeadManually.mockResolvedValue({ id: "lead-9" });
  m.convertLeadToCustomer.mockResolvedValue({
    customer: { id: "cust-1" },
    isNewAccount: true,
    activationEmailSent: false,
  });
  m.addLeadNote.mockResolvedValue(undefined);
  m.logLeadContact.mockResolvedValue(undefined);
  m.recordRealContact.mockResolvedValue(undefined);
  m.tx.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      lead: { updateMany: vi.fn(async () => ({ count: 1 })) },
      auditLog: { create: vi.fn(async () => ({})) },
    }),
  );
});

describe("lead actions check the Leads screen, not the request address", () => {
  beforeEach(() => {
    // A Driver-style job role: Today and Tasks, but no Leads screen.
    m.jobRoleScreens.mockResolvedValue(["today", "tasks"]);
  });

  it("refuses every lead action for a job role without the Leads screen", async () => {
    await expect(updateLeadStatusAction("lead-1", "CONTACTED")).rejects.toThrow(
      /does not include this screen/,
    );
    await expect(
      createLeadAction({ contactName: "Ada Example", phone: "9705551234" }),
    ).rejects.toThrow(/does not include this screen/);
    await expect(convertLeadAction("lead-1")).rejects.toThrow(/does not include this screen/);
    await expect(addLeadNoteAction("lead-1", "Called them")).rejects.toThrow(
      /does not include this screen/,
    );
    await expect(logLeadContactAction("lead-1", "Called them")).rejects.toThrow(
      /does not include this screen/,
    );
    await expect(addLeadEmailAction("lead-1", "ada@example.com")).rejects.toThrow(
      /does not include this screen/,
    );
    expect(m.updateLeadStatus).not.toHaveBeenCalled();
    expect(m.createLeadManually).not.toHaveBeenCalled();
    expect(m.convertLeadToCustomer).not.toHaveBeenCalled();
    expect(m.addLeadNote).not.toHaveBeenCalled();
    expect(m.logLeadContact).not.toHaveBeenCalled();
    expect(m.tx).not.toHaveBeenCalled();
  });

  it("lets a job role with the Leads screen work leads", async () => {
    m.jobRoleScreens.mockResolvedValue(["today", "tasks", "leads"]);
    await expect(updateLeadStatusAction("lead-1", "CONTACTED")).resolves.toEqual({
      status: "success",
    });
    expect(m.updateLeadStatus).toHaveBeenCalled();
    await expect(
      createLeadAction({ contactName: "Ada Example", phone: "9705551234" }),
    ).resolves.toEqual({ status: "success", leadId: "lead-9" });
    await expect(addLeadEmailAction("lead-1", "ada@example.com")).resolves.toEqual({
      status: "success",
    });
  });

  it("lets an owner (no job-role limit) work leads", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "owner-1", role: "OWNER" } });
    m.jobRoleScreens.mockResolvedValue(null);
    await expect(updateLeadStatusAction("lead-1", "CONTACTED")).resolves.toEqual({
      status: "success",
    });
    expect(m.updateLeadStatus).toHaveBeenCalled();
  });
});
