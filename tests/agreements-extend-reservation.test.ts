import { describe, it, expect, vi, beforeEach } from "vitest";

// extendReservation (Phase 6A item 6 — src/domains/agreements/index.ts)
// pushes a DRAFT/AWAITING_SIGNATURE agreement's reservation hold back
// out, using the owner-configurable draftReservationHoldDays. These
// tests prove it refuses on an agreement that's already
// ACTIVE/ENDED/CANCELLED (where a hold has no meaning) and that it
// actually recomputes reservationExpiresAt from BusinessSettings.

const findUniqueOrThrow = vi.fn();
const update = vi.fn();
const auditLogCreate = vi.fn();
const getBusinessSettings = vi.fn();

// extendReservation now runs in one transaction that locks the agreement row
// (FOR UPDATE) before checking its status, so the fake transaction needs the
// lock query as well as the agreement and audit writes.
function makeTx() {
  return {
    $queryRaw: async () => [{ id: "agr-1" }],
    rentalAgreement: {
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrow(...args),
      update: (...args: unknown[]) => update(...args),
    },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  },
}));

vi.mock("@/domains/settings", () => ({
  getBusinessSettings: (...args: unknown[]) => getBusinessSettings(...args),
}));

describe("extendReservation", () => {
  beforeEach(() => {
    findUniqueOrThrow.mockReset();
    update.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: "agr-1", ...data }));
    auditLogCreate.mockReset().mockResolvedValue({});
    getBusinessSettings.mockReset().mockResolvedValue({ draftReservationHoldDays: 7 });
  });

  it("pushes reservationExpiresAt out by the configured hold-days count for a DRAFT agreement", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "agr-1",
      status: "DRAFT",
      reservationExpiresAt: new Date("2026-01-01"),
    });
    const { extendReservation } = await import("@/domains/agreements");

    const before = Date.now();
    const updated = await extendReservation("owner-1", "agr-1");
    const after = Date.now();

    expect(update).toHaveBeenCalledTimes(1);
    const newExpiry = (updated as { reservationExpiresAt: Date }).reservationExpiresAt;
    const expectedMin = before + 6 * 24 * 60 * 60 * 1000; // a bit under 7 days, timing slack
    const expectedMax = after + 8 * 24 * 60 * 60 * 1000;
    expect(newExpiry.getTime()).toBeGreaterThan(expectedMin);
    expect(newExpiry.getTime()).toBeLessThan(expectedMax);

    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "agreement.extend_reservation",
          entityId: "agr-1",
        }),
      }),
    );
  });

  it("also works for an AWAITING_SIGNATURE agreement", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "agr-1",
      status: "AWAITING_SIGNATURE",
      reservationExpiresAt: new Date("2026-01-01"),
    });
    const { extendReservation } = await import("@/domains/agreements");

    await expect(extendReservation("owner-1", "agr-1")).resolves.toBeTruthy();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("refuses to extend an ACTIVE agreement's reservation — it's actually rented, not just held", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "agr-1",
      status: "ACTIVE",
      reservationExpiresAt: null,
    });
    const { extendReservation } = await import("@/domains/agreements");

    await expect(extendReservation("owner-1", "agr-1")).rejects.toThrow(
      /reservation hold to extend/i,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to extend a CANCELLED agreement's reservation — already freed", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "agr-1",
      status: "CANCELLED",
      reservationExpiresAt: null,
    });
    const { extendReservation } = await import("@/domains/agreements");

    await expect(extendReservation("owner-1", "agr-1")).rejects.toThrow(
      /reservation hold to extend/i,
    );
  });
});
