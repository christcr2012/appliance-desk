import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  address: vi.fn(),
  agreement: vi.fn(),
  successorAgreement: vi.fn(),
  request: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
  actor: vi.fn(),
}));
// createJob now runs in one transaction that first re-checks (with a row
// lock) that the acting staff member is still active and allowed, then
// validates the customer links and writes the job and audit entry.
function makeTx() {
  return {
    $queryRaw: async () => [{ id: "g1" }],
    user: { findUnique: m.actor },
    serviceAddress: { findUnique: m.address },
    rentalAgreement: { findUnique: m.agreement, findMany: m.successorAgreement },
    maintenanceRequest: { findUnique: m.request },
    job: { create: m.create },
    auditLog: { create: m.audit },
    // FEETAX-2: creating a delivery-type job also runs the delivery
    // readiness check. The fake address is confirmed into the
    // state-collected state jurisdiction only, which is ready.
    addressTaxLocation: {
      findFirst: async () => ({
        status: "VERIFIED",
        jurisdictions: [
          {
            jurisdiction: {
              id: "co",
              name: "State of Colorado",
              level: "STATE",
              administration: "STATE_COLLECTED",
            },
          },
        ],
      }),
    },
    jurisdictionReadiness: { findUnique: async () => null },
  };
}
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  },
}));
import { createJob } from "@/domains/jobs";
beforeEach(() => {
  vi.clearAllMocks();
  m.address.mockResolvedValue({ customerId: "c1", state: "CO", city: "Greeley" });
  m.agreement.mockResolvedValue({ customerId: "c1", serviceAddressId: "a1" });
  m.successorAgreement.mockResolvedValue([]);
  m.request.mockResolvedValue({ customerId: "c1" });
  m.create.mockResolvedValue({ id: "j1" });
  m.actor.mockResolvedValue({ id: "owner", role: "OWNER", archivedAt: null });
});
it("refuses a deactivated or non-admin actor before any link check or write", async () => {
  for (const actor of [
    null,
    { id: "owner", role: "OWNER", archivedAt: new Date() },
    { id: "owner", role: "STAFF", archivedAt: null },
  ]) {
    m.actor.mockResolvedValue(actor);
    await expect(
      createJob("owner", { type: "DELIVERY", customerId: "c1" }),
    ).rejects.toThrow("no longer has access");
  }
  expect(m.address).not.toHaveBeenCalled();
  expect(m.create).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});
it("rejects a foreign property before writing a job or audit", async () => {
  m.address.mockResolvedValue({ customerId: "c2" });
  await expect(
    createJob("owner", {
      type: "DELIVERY",
      customerId: "c1",
      serviceAddressId: "other",
    }),
  ).rejects.toThrow("belonging");
  expect(m.create).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});
it("requires agreement and request context to match the customer and selected property", async () => {
  await expect(
    createJob("owner", {
      type: "DELIVERY",
      customerId: "c1",
      serviceAddressId: "a2",
      agreementId: "g1",
    }),
  ).rejects.toThrow("agreement");
  m.request.mockResolvedValue({ customerId: "c2" });
  await expect(
    createJob("owner", {
      type: "MAINTENANCE_VISIT",
      customerId: "c1",
      maintenanceRequestId: "r2",
    }),
  ).rejects.toThrow("request");
  expect(m.create).not.toHaveBeenCalled();
});
it("ZONE-1: never creates a delivery visit for a rental the customer picks up (installation is still allowed)", async () => {
  m.agreement.mockResolvedValue({ customerId: "c1", serviceAddressId: "a1", deliveryZoneSnapshot: { choice: "CUSTOMER_PICKUP" } });
  await expect(createJob("owner", { type: "DELIVERY", customerId: "c1", serviceAddressId: "a1", agreementId: "g1" }))
    .rejects.toThrow(/customer pickup/);
  expect(m.create).not.toHaveBeenCalled();
  await createJob("owner", { type: "INSTALLATION", customerId: "c1", serviceAddressId: "a1", agreementId: "g1" });
  expect(m.create).toHaveBeenCalledTimes(1);
});
it("ZONE-1: a DELIVERY job for a pickup rental only as its customer pickup hand-over, and a hand-over only for pickup", async () => {
  m.agreement.mockResolvedValue({ customerId: "c1", serviceAddressId: "a1", deliveryZoneSnapshot: { choice: "CUSTOMER_PICKUP" } });
  await createJob("owner", { type: "DELIVERY", customerId: "c1", serviceAddressId: "a1", agreementId: "g1", customerPickupHandoff: true });
  expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "DELIVERY", customerPickupHandoff: true }) }));
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    newValue: expect.objectContaining({ customerPickupHandoff: true }) }) }));
  m.create.mockClear();
  await expect(createJob("owner", { type: "REMOVAL", customerId: "c1", agreementId: "g1", customerPickupHandoff: true }))
    .rejects.toThrow(/hand-over must be for a rental agreement/);
  await expect(createJob("owner", { type: "DELIVERY", customerId: "c1", customerPickupHandoff: true }))
    .rejects.toThrow(/hand-over must be for a rental agreement/);
  // A delivery rental keeps its delivery visit; it can't be turned into a pickup hand-over.
  m.agreement.mockResolvedValue({ customerId: "c1", serviceAddressId: "a1", deliveryZoneSnapshot: { choice: "DELIVER" } });
  await expect(createJob("owner", { type: "DELIVERY", customerId: "c1", serviceAddressId: "a1", agreementId: "g1", customerPickupHandoff: true }))
    .rejects.toThrow(/set to delivery/);
  expect(m.create).not.toHaveBeenCalled();
});
it("preserves a valid property visit and generic jobs with no customer links", async () => {
  await createJob("owner", {
    type: "DELIVERY",
    customerId: "c1",
    serviceAddressId: "a1",
    agreementId: "g1",
  });
  expect(m.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        customerId: "c1",
        serviceAddressId: "a1",
        agreementId: "g1",
      }),
    }),
  );
  m.address.mockClear();
  await createJob("owner", { type: "MAINTENANCE_VISIT" });
  expect(m.address).not.toHaveBeenCalled();
});
