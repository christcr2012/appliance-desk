import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  address: vi.fn(),
  agreement: vi.fn(),
  request: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceAddress: { findUnique: m.address },
    rentalAgreement: { findUnique: m.agreement },
    maintenanceRequest: { findUnique: m.request },
    job: { create: m.create },
    auditLog: { create: m.audit },
  },
}));
import { createJob } from "@/domains/jobs";
beforeEach(() => {
  vi.clearAllMocks();
  m.address.mockResolvedValue({ customerId: "c1" });
  m.agreement.mockResolvedValue({ customerId: "c1", serviceAddressId: "a1" });
  m.request.mockResolvedValue({ customerId: "c1" });
  m.create.mockResolvedValue({ id: "j1" });
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
