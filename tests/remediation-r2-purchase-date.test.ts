import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ record: vi.fn(), post: vi.fn() }));
vi.mock("@/domains/books/immediate", () => ({ postBookSourceAfterCommit: m.post }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { id: "owner-1" } }),
}));
vi.mock("@/domains/purchasing/purchases", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  recordPurchase: (...a: unknown[]) => m.record(...a),
}));

import { recordPurchaseAction } from "@/app/desk/purchases/actions";
import { parseOptionalBusinessDate } from "@/lib/business-date";

describe("R11 purchase date is a strict Colorado business date", () => {
  it.each([
    ["2026-01-15", "2026-01-15T07:00:00.000Z"],
    ["2026-07-15", "2026-07-15T06:00:00.000Z"],
    ["2026-03-08", "2026-03-08T07:00:00.000Z"],
    ["2026-11-01", "2026-11-01T06:00:00.000Z"],
  ])("%s becomes Colorado midnight", (key, iso) => {
    const parsed = parseOptionalBusinessDate(key);
    expect(parsed.ok && parsed.value?.toISOString()).toBe(iso);
  });

  it.each(["2026-02-30", "10/05/2026", "yesterday", "2026-1-5", "2026-13-01"])(
    "rejects %s",
    (bad) => expect(parseOptionalBusinessDate(bad)).toEqual({ ok: false }),
  );

  it("blank means not given", () => {
    expect(parseOptionalBusinessDate("")).toEqual({ ok: true, value: null });
  });

  describe("through the record-a-purchase action", () => {
    const base = {
      operationKey: "form-key-12345", sellerName: "Private seller", reference: "", taxAnswer: "NO",
      sellerTax: "", otherState: "", otherCharges: "", receiptSubtotal: "", receiptTotal: "", notes: "",
      documents: [], appliances: [{ applianceTypeId: "type-1", price: "100.00" }],
    };
    beforeEach(() => { m.post.mockReset().mockResolvedValue(undefined); m.record.mockReset().mockResolvedValue({
      purchaseId: "p1", purchasedOn: new Date(), appliances: [],
    }); });

    it("refuses an impossible date and records nothing", async () => {
      const result = await recordPurchaseAction({ ...base, purchasedOn: "2026-02-30" });
      expect(result.status).toBe("error");
      expect(m.record).not.toHaveBeenCalled();
    });

    it("records each appliance after a saved purchase, not before it", async()=>{
      m.record.mockResolvedValue({purchaseId:"p1",purchasedOn:new Date(),appliances:[
        {id:"ap-1",step:{headline:"Tax checked",detail:"Recorded",done:true}},
        {id:"ap-2",step:{headline:"Tax checked",detail:"Recorded",done:true}},
      ]});
      const result=await recordPurchaseAction({...base,purchasedOn:"2026-07-15"});
      expect(result.status).toBe("success");
      expect(m.post.mock.calls).toEqual([
        ["APPLIANCE","ap-1"],["APPLIANCE","ap-2"],
      ]);
    });

    it("passes a valid date as Colorado midnight, never midnight UTC", async () => {
      await recordPurchaseAction({ ...base, purchasedOn: "2026-07-15" });
      const input = m.record.mock.calls[0]![1] as { purchasedOn: Date; appliances: { priceCents: number }[] };
      expect(input.purchasedOn.toISOString()).toBe("2026-07-15T06:00:00.000Z");
      expect(input.appliances[0]!.priceCents).toBe(10000);
    });
  });
});
