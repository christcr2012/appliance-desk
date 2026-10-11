import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  prepare: vi.fn(),
  revalidatePath: vi.fn(),
  agreementFindUnique: vi.fn(),
  agreementFindMany: vi.fn(),
  snapshotFindMany: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/domains/billing/signing-charge-snapshot", () => ({
  prepareDraftSigningChargeSnapshots: mocks.prepare,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  rentalAgreement: { findUnique: mocks.agreementFindUnique, findMany: mocks.agreementFindMany },
  agreementSigningCharge: { findMany: mocks.snapshotFindMany },
} }));

import { prepareSigningChargesAction } from "@/app/desk/agreements/[id]/signing-charge-actions";
import { getPreparedSigningChargeReview } from "@/domains/billing/signing-charge-review";

const form = (id: string) => {
  const value = new FormData();
  value.set("agreementId", id);
  return value;
};

describe("W-22 owner draft charge preparation action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({ user: { id: "owner" } });
    mocks.prepare.mockResolvedValue({ snapshots: [{ agreementId: "a" }, { agreementId: "b" }],
      requiresTaxReview: true, amountBeforeTaxCents: 9000 });
  });
  it("checks owner/admin session first and never accepts client-submitted prices", async () => {
    const id = "agreement-12345";
    const result = await prepareSigningChargesAction({ ok: false, message: "" }, form(id));
    expect(mocks.requireRole).toHaveBeenCalledWith("OWNER", "ADMIN");
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith("owner", id);
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith(`/desk/agreements/${id}`);
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toContain("No payment was collected");
  });
  it("does not call a billing service or mutate when an identifier is invalid", async () => {
    const response = await prepareSigningChargesAction({ ok: false, message: "" }, form("../other"));
    expect(response.ok).toBe(false);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it("does not expose raw internal exception messages to the UI", async () => {
    mocks.prepare.mockRejectedValue(new Error("secret provider or database info"));
    const response = await prepareSigningChargesAction({ ok: false, message: "" },
      form("agreement-12345"));
    expect(response.ok).toBe(false);
    expect(response.message).not.toContain("secret");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it("cannot bypass authentication through an action URL", async () => {
    mocks.requireRole.mockRejectedValue(new Error("Not signed in"));
    await expect(prepareSigningChargesAction({ ok: false, message: "" },
      form("agreement-12345"))).rejects.toThrow(/Not signed in/);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});

describe("W-22B1 private prepared-order reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({ user: { id: "owner" } });
    mocks.agreementFindUnique.mockResolvedValue({
      id: "agreement-a", customerId: "customer-a",
      sourceEstimateId: "quote-a", status: "DRAFT",
    });
    mocks.agreementFindMany.mockResolvedValue([
      { id: "agreement-a", status: "DRAFT" },
      { id: "agreement-b", status: "DRAFT" },
    ]);
    mocks.snapshotFindMany.mockResolvedValue([
      { id: "snapshot-a", agreementId: "agreement-a" },
      { id: "snapshot-b", agreementId: "agreement-b" },
    ]);
  });
  it("rechecks owner/admin and scopes every read to the target customer and quote", async () => {
    const result = await getPreparedSigningChargeReview("agreement-a");
    expect(result).toHaveLength(2);
    expect(mocks.requireRole).toHaveBeenCalledWith("OWNER", "ADMIN");
    expect(mocks.agreementFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId: "customer-a", sourceEstimateId: "quote-a" },
    }));
    expect(mocks.snapshotFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        agreementId: { in: ["agreement-a", "agreement-b"] },
        agreement: { customerId: "customer-a", status: "DRAFT" },
      },
    }));
  });
  it("never exposes partial records for a multi-address order", async () => {
    mocks.snapshotFindMany.mockResolvedValue([{ id: "snapshot-a", agreementId: "agreement-a" }]);
    expect(await getPreparedSigningChargeReview("agreement-a")).toEqual([]);
  });
  it("refuses to display prepared amounts when a sibling is no longer a draft", async () => {
    mocks.agreementFindMany.mockResolvedValue([
      { id: "agreement-a", status: "DRAFT" },
      { id: "agreement-b", status: "AWAITING_SIGNATURE" },
    ]);
    expect(await getPreparedSigningChargeReview("agreement-a")).toEqual([]);
    expect(mocks.snapshotFindMany).not.toHaveBeenCalled();
  });
  it("rejects unauthorized staff even when an agreement id is known", async () => {
    mocks.requireRole.mockRejectedValue(new Error("Forbidden"));
    await expect(getPreparedSigningChargeReview("agreement-a")).rejects.toThrow(/Forbidden/);
    expect(mocks.agreementFindUnique).not.toHaveBeenCalled();
  });
});
