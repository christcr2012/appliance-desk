import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(async () => ({ user: { id: "owner-1", role: "OWNER" } })),
  create: vi.fn(async () => ({ id: "ex-1" })),
  update: vi.fn(async () => ({ id: "ex-1" })),
  revoke: vi.fn(async () => ({ id: "ex-1" })),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/domains/tax/exemptions", () => ({
  createCustomerTaxExemption: mocks.create,
  updateCustomerTaxExemption: mocks.update,
  revokeCustomerTaxExemption: mocks.revoke,
}));
vi.mock("@/lib/photo-storage", () => ({
  getPrivatePhotoStore: () => ({ token: "private", storeId: "store_teststore" }),
  privatePhotoPathFromUrl: (value: string) =>
    value === "good-photo"
      ? "tax-exemptions/customer-1/certificate.jpg"
      : value === "other-customer"
        ? "tax-exemptions/customer-2/certificate.jpg"
        : null,
}));

import { saveCustomerTaxExemptionAction } from "@/app/desk/customers/actions";

const base = {
  reason: "RESALE" as const,
  certificateNumber: "CERT-1",
  certificatePhotoId: "good-photo",
  validFrom: "2026-10-01",
  expiresOn: "2027-09-30",
  allJurisdictions: true,
  jurisdictionIds: [] as string[],
  notes: "",
};

describe("customer tax exemption server action", () => {
  beforeEach(() => {
    mocks.create.mockClear();
    mocks.update.mockClear();
    mocks.revoke.mockClear();
    mocks.revalidate.mockClear();
    mocks.requireRole.mockClear();
  });

  it("rejects a specific-jurisdiction exemption with no selected jurisdiction", async () => {
    const result = await saveCustomerTaxExemptionAction("customer-1", {
      ...base,
      allJurisdictions: false,
      jurisdictionIds: [],
    });
    expect(result).toEqual(
      expect.objectContaining({ status: "error" }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a certificate reference outside this customer's authorized private namespace", async () => {
    const result = await saveCustomerTaxExemptionAction("customer-1", {
      ...base,
      certificatePhotoId: "other-customer",
    });
    expect(result).toEqual(
      expect.objectContaining({ status: "error" }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("passes a valid all-jurisdiction exemption to the owner-only domain", async () => {
    const result = await saveCustomerTaxExemptionAction("customer-1", base);
    expect(result).toEqual({ status: "success" });
    expect(mocks.requireRole).toHaveBeenCalledWith("OWNER");
    expect(mocks.create).toHaveBeenCalledWith(
      "owner-1",
      "customer-1",
      expect.objectContaining({
        reason: "RESALE",
        certificatePhotoId: "good-photo",
        jurisdictionIds: [],
      }),
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/desk/customers/customer-1");
  });
});
