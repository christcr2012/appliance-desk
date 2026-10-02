import { describe, it, expect, vi, beforeEach } from "vitest";

// Verified Finding #3: addRentalLine used to check appliance availability
// with a plain read *before* opening its transaction, then reserve it with
// an unconditional update inside the transaction — two concurrent calls
// could both pass the read and both "win" the reservation. This test
// proves the fix's actual guard: the reservation itself must be an atomic
// conditional update (`updateMany` requiring `status: "AVAILABLE"`), and a
// `count` of anything other than 1 must abort the whole transaction rather
// than silently proceeding. Real concurrent-request behavior needs a real
// database under load (tracked as future integration-test infrastructure,
// see docs/HANDOFF.md) — this proves the guard logic itself is correct and
// wired in the right order.

const findUniqueOrThrow = vi.fn();
const rentalLineCreate = vi.fn();
const applianceUpdateMany = vi.fn();
const applianceFindUnique = vi.fn();
const applianceAssignmentCreate = vi.fn();
const auditLogCreate = vi.fn();
const getBusinessSettings = vi.fn();

function makeTx() {
  return {
    // addRentalLine now locks the agreement row (FOR UPDATE) inside the
    // transaction and reads the agreement through tx, so the fake tx needs both.
    $queryRaw: async () => [{ id: "agr-1" }],
    rentalAgreement: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrow(...args) },
    rentalLine: { create: rentalLineCreate },
    appliance: { updateMany: applianceUpdateMany, findUnique: applianceFindUnique },
    applianceAssignment: { create: applianceAssignmentCreate },
    auditLog: { create: auditLogCreate },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    rentalAgreement: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrow(...args) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  },
}));

// addRentalLine also computes the prepaid-term discount (see
// tests/agreements-prepay-discount.test.ts for that behavior in detail) —
// mocked here to return no discount so this file's assertions stay purely
// about the reservation race-condition guard.
vi.mock("@/domains/settings", () => ({
  getBusinessSettings: (...args: unknown[]) => getBusinessSettings(...args),
}));

describe("addRentalLine — atomic reservation", () => {
  beforeEach(() => {
    findUniqueOrThrow
      .mockReset()
      .mockResolvedValue({ id: "agr-1", status: "DRAFT", termMonths: null });
    rentalLineCreate.mockReset().mockResolvedValue({ id: "line-1" });
    applianceUpdateMany.mockReset();
    applianceFindUnique.mockReset();
    applianceAssignmentCreate.mockReset().mockResolvedValue({});
    auditLogCreate.mockReset().mockResolvedValue({});
    getBusinessSettings.mockReset().mockResolvedValue({
      sixMonthPrepayDiscountSetCents: 0,
      sixMonthPrepayDiscountSingleCents: 0,
      twelveMonthPrepayDiscountSetCents: 0,
      twelveMonthPrepayDiscountSingleCents: 0,
      twelveMonthPrepayFreeMonthEnabled: false,
    });
  });

  it("reserves via a conditional updateMany requiring status AVAILABLE, not a plain update", async () => {
    applianceUpdateMany.mockResolvedValue({ count: 1 });
    const { addRentalLine } = await import("@/domains/agreements");

    await addRentalLine("user-1", "agr-1", {
      label: "Washer",
      listPriceCents: 3500,
      applianceIds: ["appl-1"],
    });

    expect(applianceUpdateMany).toHaveBeenCalledWith({
      where: { id: "appl-1", status: "AVAILABLE" },
      data: { status: "RESERVED" },
    });
    expect(applianceAssignmentCreate).toHaveBeenCalledWith({
      data: { rentalLineId: "line-1", applianceId: "appl-1" },
    });
  });

  it("aborts (never creates the assignment) when the conditional update loses the race — count 0", async () => {
    applianceUpdateMany.mockResolvedValue({ count: 0 });
    applianceFindUnique.mockResolvedValue({ assetNumber: "A-100" });
    const { addRentalLine } = await import("@/domains/agreements");

    await expect(
      addRentalLine("user-1", "agr-1", {
        label: "Washer",
        listPriceCents: 3500,
        applianceIds: ["appl-1"],
      }),
    ).rejects.toThrow(/isn't AVAILABLE right now/);

    expect(applianceAssignmentCreate).not.toHaveBeenCalled();
  });

  it("aborts the whole line — including appliances already reserved earlier in the same call — if any appliance in the batch loses the race", async () => {
    applianceUpdateMany
      .mockResolvedValueOnce({ count: 1 }) // first appliance in the set wins
      .mockResolvedValueOnce({ count: 0 }); // second appliance (e.g. the dryer) loses
    applianceFindUnique.mockResolvedValue({ assetNumber: "A-200" });
    const { addRentalLine } = await import("@/domains/agreements");

    await expect(
      addRentalLine("user-1", "agr-1", {
        label: "Washer + dryer set",
        listPriceCents: 6000,
        applianceIds: ["appl-1", "appl-2"],
      }),
    ).rejects.toThrow(/isn't AVAILABLE right now/);

    // The audit log entry (and thus the whole line) must never be
    // recorded as successfully created — the caller's $transaction mock
    // here just runs the function directly, but a real Prisma transaction
    // rolls back every write made inside it (including appl-1's own
    // reservation) once this throw propagates out.
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("refuses to add a line to an agreement that isn't still DRAFT", async () => {
    findUniqueOrThrow.mockResolvedValue({ id: "agr-1", status: "ACTIVE", termMonths: null });
    const { addRentalLine } = await import("@/domains/agreements");

    await expect(
      addRentalLine("user-1", "agr-1", {
        label: "Washer",
        listPriceCents: 3500,
        applianceIds: ["appl-1"],
      }),
    ).rejects.toThrow(/only add appliances to a draft agreement/i);
    expect(applianceUpdateMany).not.toHaveBeenCalled();
  });
});
