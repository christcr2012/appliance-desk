import { describe, it, expect, vi, beforeEach } from "vitest";

// Customer workspace (2026-09-28, /desk/customers/[id]) — notes, contacts,
// and the merged timeline. Mocked prisma (same pattern as
// tests/active-appliances.test.ts) since these are thin DB wrappers /
// pure merge-and-sort logic, not something that needs a real database to
// prove correct.

const customerNoteCreate = vi.fn();
const customerContactCreate = vi.fn();
const customerContactDeleteMany = vi.fn();
const customerContactFindMany = vi.fn();
const rentalAgreementFindMany = vi.fn();
const jobFindMany = vi.fn();
const maintenanceRequestFindMany = vi.fn();
const customerNoteFindMany = vi.fn();
const auditLogFindMany = vi.fn();

vi.mock("@/lib/session", () => ({ requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }) }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerNote: {
      create: (...args: unknown[]) => customerNoteCreate(...args),
      findMany: (...args: unknown[]) => customerNoteFindMany(...args),
    },
    customerContact: {
      create: (...args: unknown[]) => customerContactCreate(...args),
      deleteMany: (...args: unknown[]) => customerContactDeleteMany(...args),
      findMany: (...args: unknown[]) => customerContactFindMany(...args),
    },
    rentalAgreement: { findMany: (...args: unknown[]) => rentalAgreementFindMany(...args) },
    job: { findMany: (...args: unknown[]) => jobFindMany(...args) },
    maintenanceRequest: { findMany: (...args: unknown[]) => maintenanceRequestFindMany(...args) },
    auditLog: { findMany: (...args: unknown[]) => auditLogFindMany(...args) },
  },
}));

describe("addCustomerNote", () => {
  beforeEach(() => {
    customerNoteCreate.mockReset().mockResolvedValue({});
  });

  it("saves a trimmed note against the customer and author", async () => {
    const { addCustomerNote } = await import("@/domains/customers/timeline");
    await addCustomerNote("cust-1", "user-1", "  Called about the dryer.  ");

    expect(customerNoteCreate).toHaveBeenCalledWith({
      data: { customerId: "cust-1", authorId: "user-1", body: "Called about the dryer." },
    });
  });

  it("rejects an empty or whitespace-only note without hitting the database", async () => {
    const { addCustomerNote } = await import("@/domains/customers/timeline");
    await expect(addCustomerNote("cust-1", "user-1", "   ")).rejects.toThrow(/empty/i);
    expect(customerNoteCreate).not.toHaveBeenCalled();
  });
});

describe("addCustomerContact", () => {
  beforeEach(() => {
    customerContactCreate.mockReset().mockResolvedValue({});
  });

  it("requires a name", async () => {
    const { addCustomerContact } = await import("@/domains/customers/timeline");
    await expect(addCustomerContact("cust-1", { name: "  " })).rejects.toThrow(/name/i);
    expect(customerContactCreate).not.toHaveBeenCalled();
  });

  it("saves optional fields as null rather than empty strings when blank", async () => {
    const { addCustomerContact } = await import("@/domains/customers/timeline");
    await addCustomerContact("cust-1", { name: "Jane Doe", role: "", phone: "", email: "", notes: "" });

    expect(customerContactCreate).toHaveBeenCalledWith({
      data: {
        customerId: "cust-1",
        name: "Jane Doe",
        role: null,
        phone: null,
        email: null,
        notes: null,
      },
    });
  });
});

describe("deleteCustomerContact", () => {
  it("scopes the delete to both the contact id AND the customer id, never just the contact id alone", async () => {
    customerContactDeleteMany.mockReset().mockResolvedValue({ count: 1 });
    const { deleteCustomerContact } = await import("@/domains/customers/timeline");

    await deleteCustomerContact("cust-1", "contact-1");

    expect(customerContactDeleteMany).toHaveBeenCalledWith({
      where: { id: "contact-1", customerId: "cust-1" },
    });
  });
});

describe("getCustomerTimeline", () => {
  beforeEach(() => {
    rentalAgreementFindMany.mockReset().mockResolvedValue([{ id: "agr-1" }]);
    jobFindMany.mockReset().mockResolvedValue([{ id: "job-1" }]);
    maintenanceRequestFindMany.mockReset().mockResolvedValue([]);
    customerNoteFindMany.mockReset().mockResolvedValue([
      {
        id: "note-1",
        body: "Called about billing.",
        createdAt: new Date("2026-09-20"),
        author: { name: "Chris", email: "chris@example.test" },
      },
    ]);
    auditLogFindMany.mockReset().mockResolvedValue([
      {
        id: "audit-1",
        action: "agreement.sign",
        createdAt: new Date("2026-09-15"),
        user: null,
      },
      {
        id: "audit-2",
        action: "some.unmapped.action",
        createdAt: new Date("2026-09-10"),
        user: { name: null, email: "staff@example.test" },
      },
    ]);
  });

  it("queries audit log for the customer itself plus every one of their agreements/jobs/maintenance requests", async () => {
    const { getCustomerTimeline } = await import("@/domains/customers/timeline");
    await getCustomerTimeline("cust-1");

    const [{ where }] = auditLogFindMany.mock.calls[0];
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { entityType: "Customer", entityId: "cust-1" },
        { entityType: "RentalAgreement", entityId: "agr-1" },
        { entityType: "Job", entityId: "job-1" },
      ]),
    );
  });

  it("merges notes and audit activity into one list, newest first", async () => {
    const { getCustomerTimeline } = await import("@/domains/customers/timeline");
    const timeline = await getCustomerTimeline("cust-1");

    expect(timeline.map((e) => e.id)).toEqual(["note-note-1", "audit-audit-1", "audit-audit-2"]);
    expect(timeline[0].kind).toBe("note");
    expect(timeline[0].detail).toBe("Called about billing.");
    expect(timeline[1].kind).toBe("activity");
    expect(timeline[1].summary).toBe("Rental agreement signed"); // known action, mapped to plain English
  });

  it("falls back to the raw action string for an action it doesn't specifically recognize", async () => {
    const { getCustomerTimeline } = await import("@/domains/customers/timeline");
    const timeline = await getCustomerTimeline("cust-1");

    const unmapped = timeline.find((e) => e.id === "audit-audit-2");
    expect(unmapped?.summary).toBe("some.unmapped.action");
    expect(unmapped?.authorName).toBe("staff@example.test"); // falls back to email when no name
  });

  it("skips the audit log query entirely for a customer with no agreements/jobs/requests at all (just the Customer entity itself still queried)", async () => {
    rentalAgreementFindMany.mockResolvedValue([]);
    jobFindMany.mockResolvedValue([]);
    maintenanceRequestFindMany.mockResolvedValue([]);
    const { getCustomerTimeline } = await import("@/domains/customers/timeline");

    await getCustomerTimeline("cust-2");

    // Still queried — "Customer" entityId is always in the filter list.
    expect(auditLogFindMany).toHaveBeenCalled();
    const [{ where }] = auditLogFindMany.mock.calls[0];
    expect(where.OR).toEqual([{ entityType: "Customer", entityId: "cust-2" }]);
  });
});

