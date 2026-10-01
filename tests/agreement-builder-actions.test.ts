import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), create: vi.fn(), add: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: m.guard }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/domains/agreements", () => ({
  createDraftAgreement: m.create,
  addRentalLine: m.add,
}));
import {
  createDraftAgreementAction,
  addRentalLineAction,
} from "@/app/desk/agreements/actions";
const input = { customerId: "c1", serviceAddressId: "a1" };
beforeEach(() => {
  vi.clearAllMocks();
  m.guard.mockResolvedValue({ user: { id: "owner" } });
  m.create.mockResolvedValue({ id: "a1", status: "DRAFT" });
});
it("rejects fractional, prefix-parsed, zero and negative terms and string booleans", async () => {
  for (const termMonths of ["6abc", "1.5", "0", "-1"])
    expect(
      await createDraftAgreementAction({ ...input, termMonths }),
    ).toMatchObject({ status: "error" });
  expect(
    await createDraftAgreementAction({
      ...input,
      paidInFullInAdvance: "false",
    }),
  ).toMatchObject({ status: "error" });
  expect(m.create).not.toHaveBeenCalled();
});
it("preserves existing custom whole-month terms and returns recorded agreement status", async () => {
  expect(
    await createDraftAgreementAction({ ...input, termMonths: "3" }),
  ).toMatchObject({ status: "success", agreementStatus: "DRAFT" });
  expect(m.create).toHaveBeenCalledWith(
    "owner",
    expect.objectContaining({ termMonths: 3 }),
  );
});
it("returns the stored discounted cents from the domain instead of recomputing them", async () => {
  m.add.mockResolvedValue({
    id: "line1",
    label: "Washer",
    monthlyPriceCents: 3250,
  });
  expect(
    await addRentalLineAction("a1", {
      label: "Washer",
      listPriceDollars: 35,
      applianceIds: ["unit"],
    }),
  ).toEqual({
    status: "success",
    line: { id: "line1", label: "Washer", monthlyPriceCents: 3250 },
  });
});
it("guards before any draft or line write", async () => {
  m.guard.mockRejectedValue(new Error("denied"));
  await expect(createDraftAgreementAction(input)).rejects.toThrow("denied");
  expect(m.create).not.toHaveBeenCalled();
});
