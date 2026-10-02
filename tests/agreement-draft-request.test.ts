import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  address: vi.fn(),
  existing: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
  settings: vi.fn(),
  tx: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceAddress: { findUnique: m.address },
    rentalAgreement: { findUnique: m.existing },
    $transaction: m.tx,
  },
}));
vi.mock("@/domains/settings", () => ({ getBusinessSettings: m.settings }));
import { createDraftAgreement } from "@/domains/agreements";
import { draftRequestId } from "@/domains/agreements/draft-request";
const key = "80aa87a2-2d19-442e-8fe8-e34e66168baa";
const input = { customerId: "c1", serviceAddressId: "a1", requestKey: key };
const saved = {
  id: draftRequestId("owner", key),
  customerId: "c1",
  serviceAddressId: "a1",
  termMonths: null,
  depositCents: 0,
  damageWaiverCents: 0,
  lateFeeGraceDays: 5,
  lateFeeCents: 0,
  lateFeePercent: 0,
  taxRatePermille: 0,
  paidInFullInAdvance: false,
  freeMonthGranted: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  m.address.mockResolvedValue({
    customerId: "c1",
    customer: { archivedAt: null },
  });
  m.existing.mockResolvedValue(null);
  m.create.mockResolvedValue(saved);
  m.audit.mockResolvedValue({});
  m.settings.mockResolvedValue({
    twelveMonthPrepayFreeMonthEnabled: true,
    draftReservationHoldDays: 7,
  });
  m.tx.mockImplementation(async (callback) =>
    callback({
      // The property check now happens inside the same transaction as the
      // insert, so a bad property rolls everything back before any write.
      serviceAddress: { findUnique: m.address },
      rentalAgreement: { create: m.create },
      auditLog: { create: m.audit },
    }),
  );
});
it("scopes a stable save identity to the actor and rejects malformed keys", () => {
  expect(draftRequestId("owner", key)).toBe(
    draftRequestId("owner", key.toUpperCase()),
  );
  expect(draftRequestId("another-owner", key)).not.toBe(saved.id);
  expect(() => draftRequestId("owner", "raw-record-id")).toThrow();
});
it("resumes the saved request without another insert, audit or settings recomputation", async () => {
  m.existing.mockResolvedValue(saved);
  expect(await createDraftAgreement("owner", input)).toEqual(saved);
  expect(m.tx).not.toHaveBeenCalled();
  expect(m.settings).not.toHaveBeenCalled();
});
it("recovers a competing unique-key winner without another committed draft", async () => {
  m.existing.mockResolvedValueOnce(null).mockResolvedValueOnce(saved);
  m.create.mockRejectedValue({ code: "P2002" });
  expect(await createDraftAgreement("owner", input)).toEqual(saved);
  expect(m.audit).not.toHaveBeenCalled();
});
it("rejects different terms using the same save identity", async () => {
  m.existing.mockResolvedValue(saved);
  await expect(
    createDraftAgreement("owner", { ...input, depositCents: 100 }),
  ).rejects.toThrow("different terms");
  expect(m.tx).not.toHaveBeenCalled();
});
it("rejects a foreign or archived property before any draft or audit write", async () => {
  for (const address of [
    null,
    { customerId: "c2", customer: { archivedAt: null } },
    { customerId: "c1", customer: { archivedAt: new Date() } },
  ]) {
    m.address.mockResolvedValue(address);
    await expect(createDraftAgreement("owner", input)).rejects.toThrow(
      "active customer",
    );
  }
  expect(m.create).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});
it("uses one transaction for the draft and audit and propagates an audit failure", async () => {
  m.audit.mockRejectedValue(new Error("audit down"));
  await expect(createDraftAgreement("owner", input)).rejects.toThrow(
    "audit down",
  );
  expect(m.create.mock.calls[0][0].data.id).toBe(saved.id);
});
