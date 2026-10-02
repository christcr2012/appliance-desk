import { describe, it, expect, vi, beforeEach } from "vitest";

// Verifies the wiring, not just the pure math (tests/prepay-discount.test.ts
// covers that): createDraftAgreement must reject an invalid
// paidInFullInAdvance + termMonths combination and snapshot
// freeMonthGranted correctly, and addRentalLine must actually apply the
// current BusinessSettings discount into the line it creates.

const findUniqueOrThrow = vi.fn();
const rentalAgreementCreate = vi.fn();
const rentalLineCreate = vi.fn();
const applianceUpdateMany = vi.fn();
const applianceAssignmentCreate = vi.fn();
const auditLogCreate = vi.fn();
const getBusinessSettings = vi.fn();

function makeTx() {
  return {
    // Agreement writes now run inside one transaction that first locks the
    // agreement row (FOR UPDATE) and validates the service address inside it.
    $queryRaw: async () => [{ id: "agr-1" }],
    serviceAddress: {
      findUnique: async () => ({
        customerId: "cust-1",
        customer: { archivedAt: null },
      }),
    },
    rentalAgreement: {
      create: rentalAgreementCreate,
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrow(...args),
    },
    rentalLine: { create: rentalLineCreate },
    appliance: { updateMany: applianceUpdateMany, findUnique: vi.fn() },
    applianceAssignment: { create: applianceAssignmentCreate },
    auditLog: { create: auditLogCreate },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceAddress: {
      findUnique: async () => ({
        customerId: "cust-1",
        customer: { archivedAt: null },
      }),
    },
    rentalAgreement: {
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrow(...args),
      create: (...args: unknown[]) => rentalAgreementCreate(...args),
    },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  },
}));

vi.mock("@/domains/settings", () => ({
  getBusinessSettings: (...args: unknown[]) => getBusinessSettings(...args),
}));

const DEFAULT_SETTINGS = {
  sixMonthPrepayDiscountSetCents: 500,
  sixMonthPrepayDiscountSingleCents: 250,
  twelveMonthPrepayDiscountSetCents: 1000,
  twelveMonthPrepayDiscountSingleCents: 500,
  twelveMonthPrepayFreeMonthEnabled: true,
  draftReservationHoldDays: 7,
};

describe("createDraftAgreement — prepaid-term discount wiring", () => {
  beforeEach(() => {
    rentalAgreementCreate
      .mockReset()
      .mockImplementation(({ data }: { data: unknown }) => ({
        id: "agr-1",
        ...(data as object),
      }));
    auditLogCreate.mockReset().mockResolvedValue({});
    getBusinessSettings.mockReset().mockResolvedValue(DEFAULT_SETTINGS);
  });

  it("rejects paidInFullInAdvance on anything other than a 12-month term", async () => {
    const { createDraftAgreement } = await import("@/domains/agreements");

    await expect(
      createDraftAgreement("user-1", {
        customerId: "cust-1",
        serviceAddressId: "addr-1",
        termMonths: 6,
        paidInFullInAdvance: true,
      }),
    ).rejects.toThrow(/only applies to a 12-month term/i);

    expect(rentalAgreementCreate).not.toHaveBeenCalled();
  });

  it("grants freeMonthGranted for a 12-month term paid in advance, with the bonus enabled", async () => {
    const { createDraftAgreement } = await import("@/domains/agreements");

    await createDraftAgreement("user-1", {
      customerId: "cust-1",
      serviceAddressId: "addr-1",
      termMonths: 12,
      paidInFullInAdvance: true,
    });

    expect(rentalAgreementCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          termMonths: 12,
          paidInFullInAdvance: true,
          freeMonthGranted: true,
        }),
      }),
    );
  });

  it("never grants freeMonthGranted if the owner has the bonus turned off, even when everything else qualifies", async () => {
    getBusinessSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      twelveMonthPrepayFreeMonthEnabled: false,
    });
    const { createDraftAgreement } = await import("@/domains/agreements");

    await createDraftAgreement("user-1", {
      customerId: "cust-1",
      serviceAddressId: "addr-1",
      termMonths: 12,
      paidInFullInAdvance: true,
    });

    expect(rentalAgreementCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ freeMonthGranted: false }),
      }),
    );
  });

  it("never grants the bonus on a month-to-month agreement", async () => {
    const { createDraftAgreement } = await import("@/domains/agreements");

    await createDraftAgreement("user-1", {
      customerId: "cust-1",
      serviceAddressId: "addr-1",
      termMonths: null,
    });

    expect(rentalAgreementCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paidInFullInAdvance: false,
          freeMonthGranted: false,
        }),
      }),
    );
  });

  it("sets reservationExpiresAt using the owner-configured hold-days count (Phase 6A item 6)", async () => {
    getBusinessSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      draftReservationHoldDays: 3,
    });
    const { createDraftAgreement } = await import("@/domains/agreements");

    const before = Date.now();
    await createDraftAgreement("user-1", {
      customerId: "cust-1",
      serviceAddressId: "addr-1",
      termMonths: null,
    });
    const after = Date.now();

    const call = rentalAgreementCreate.mock.calls[0][0];
    const expiresAt: Date = call.data.reservationExpiresAt;
    expect(expiresAt.getTime()).toBeGreaterThan(
      before + 2 * 24 * 60 * 60 * 1000,
    );
    expect(expiresAt.getTime()).toBeLessThan(after + 4 * 24 * 60 * 60 * 1000);
  });
});

describe("addRentalLine — prepaid-term discount wiring", () => {
  beforeEach(() => {
    findUniqueOrThrow.mockReset();
    rentalLineCreate.mockReset().mockResolvedValue({ id: "line-1" });
    applianceUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    applianceAssignmentCreate.mockReset().mockResolvedValue({});
    auditLogCreate.mockReset().mockResolvedValue({});
    getBusinessSettings.mockReset().mockResolvedValue(DEFAULT_SETTINGS);
  });

  it("applies the SET discount for a 12-month agreement's 2-appliance line", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "agr-1",
      status: "DRAFT",
      termMonths: 12,
    });
    const { addRentalLine } = await import("@/domains/agreements");

    await addRentalLine("user-1", "agr-1", {
      label: "Washer + dryer set",
      listPriceCents: 6000,
      applianceIds: ["appl-1", "appl-2"],
    });

    expect(rentalLineCreate).toHaveBeenCalledWith({
      data: {
        agreementId: "agr-1",
        label: "Washer + dryer set",
        listPriceCents: 6000,
        prepayDiscountCentsPerMonth: 1000,
        monthlyPriceCents: 5000,
      },
    });
  });

  it("applies the SINGLE discount for a 6-month agreement's 1-appliance line", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "agr-1",
      status: "DRAFT",
      termMonths: 6,
    });
    const { addRentalLine } = await import("@/domains/agreements");

    await addRentalLine("user-1", "agr-1", {
      label: "Washer",
      listPriceCents: 3500,
      applianceIds: ["appl-1"],
    });

    expect(rentalLineCreate).toHaveBeenCalledWith({
      data: {
        agreementId: "agr-1",
        label: "Washer",
        listPriceCents: 3500,
        prepayDiscountCentsPerMonth: 250,
        monthlyPriceCents: 3250,
      },
    });
  });

  it("applies no discount for a month-to-month agreement", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "agr-1",
      status: "DRAFT",
      termMonths: null,
    });
    const { addRentalLine } = await import("@/domains/agreements");

    await addRentalLine("user-1", "agr-1", {
      label: "Washer",
      listPriceCents: 3500,
      applianceIds: ["appl-1"],
    });

    expect(rentalLineCreate).toHaveBeenCalledWith({
      data: {
        agreementId: "agr-1",
        label: "Washer",
        listPriceCents: 3500,
        prepayDiscountCentsPerMonth: 0,
        monthlyPriceCents: 3500,
      },
    });
  });

  it("never lets the discount push the charged price below $0", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "agr-1",
      status: "DRAFT",
      termMonths: 12,
    });
    const { addRentalLine } = await import("@/domains/agreements");

    await addRentalLine("user-1", "agr-1", {
      label: "Cheap single appliance",
      listPriceCents: 200, // less than the $5.00 single-unit 12-month discount
      applianceIds: ["appl-1"],
    });

    expect(rentalLineCreate).toHaveBeenCalledWith({
      data: {
        agreementId: "agr-1",
        label: "Cheap single appliance",
        listPriceCents: 200,
        prepayDiscountCentsPerMonth: 500,
        monthlyPriceCents: 0,
      },
    });
  });
});
