import { describe, expect, it } from "vitest";
import { reconcilePurchase, splitSellerTax } from "@/domains/purchasing/purchase-math";
import { normalizePurchase, type RecordPurchaseInput } from "@/domains/purchasing/purchases";
import { nextPurchaseTaxStep, type PurchaseTaxSubject } from "@/domains/tax/next-step";
import { auditPackCsv, AUDIT_PACK_COLUMNS, parseAuditRange, type AuditPack } from "@/domains/tax/tax-proof";
import { businessDateFromKey } from "@/lib/business-date";

const day = (key: string) => businessDateFromKey(key)!;

describe("W-14 seller-tax split and receipt reconciliation", () => {
  it("splits by price with largest remainder and always adds to the printed tax", () => {
    const { shares, basis } = splitSellerTax([40000, 25000, 10000], 5333);
    expect(basis).toBe("BY_PRICE");
    expect(shares.reduce((a, b) => a + b, 0)).toBe(5333);
    expect(shares[0]).toBeGreaterThan(shares[1]!);
    expect(shares[1]).toBeGreaterThan(shares[2]!);
  });
  it("splits equally only when every price is zero, and gives nothing when there is no tax", () => {
    expect(splitSellerTax([0, 0, 0], 100)).toEqual({ shares: [34, 33, 33], basis: "EQUAL" });
    expect(splitSellerTax([500, 700], 0)).toEqual({ shares: [0, 0], basis: "NONE" });
  });
  it("proves subtotal + tax + other charges to the cent and names the mismatch in plain words", () => {
    const ok = reconcilePurchase({ pricesCents: [10000, 20000], sellerTaxCents: 2100, otherChargesCents: 1500, receiptSubtotalCents: 30000, receiptTotalCents: 33600 });
    expect(ok.problems).toEqual([]);
    expect(ok.receiptTotalCents).toBe(33600);
    const bad = reconcilePurchase({ pricesCents: [10000, 20000], sellerTaxCents: 2100, otherChargesCents: 0, receiptSubtotalCents: 29999, receiptTotalCents: 32000 });
    expect(bad.problems).toHaveLength(2);
    expect(bad.problems[0]).toContain("$300.00");
  });
  it("refuses fractional or negative cents", () => {
    expect(() => splitSellerTax([100.5], 10)).toThrow();
    expect(() => splitSellerTax([100], -1)).toThrow();
  });
});

const base: RecordPurchaseInput = {
  operationKey: "form-key-12345", sellerName: "Private seller", purchasedOn: day("2026-10-01"),
  taxAnswer: "NO", sellerTaxCents: 0, otherChargesCents: 0, documents: [],
  appliances: [{ applianceTypeId: "t1", priceCents: 10000 }],
};

describe("W-14 purchase input rules", () => {
  it("accepts a clean purchase", () => expect(() => normalizePurchase(base)).not.toThrow());
  it.each<[string, Partial<RecordPurchaseInput>, string]>([
    ["no seller", { sellerName: "" }, "supplier or type"],
    ["both sellers", { supplierId: "s1" }, "not both"],
    ["no appliances", { appliances: [] }, "at least one appliance"],
    ["a taxed answer with no tax", { taxAnswer: "YES_COLORADO", sellerTaxCents: 0 }, "tax printed"],
    ["tax on a no-tax answer", { taxAnswer: "NO", sellerTaxCents: 100 }, "only be entered"],
    ["another state without a name", { taxAnswer: "YES_OTHER_STATE", sellerTaxCents: 100 }, "which state"],
    ["a receipt total that disagrees", { receiptTotalCents: 1 }, "receipt total"],
    ["a state on a Colorado answer", { taxAnswer: "YES_COLORADO", sellerTaxCents: 100, otherState: "Utah" }, "another state"],
    ["a weak form key", { operationKey: "x" }, "no valid identity"],
    ["a duplicated receipt page", { documents: [{ url: "https://a/x" }, { url: "https://a/x" }] }, "twice"],
  ])("refuses %s", (_name, patch, message) => {
    expect(() => normalizePurchase({ ...base, ...patch })).toThrow(message);
  });
  it("allows a taxed receipt with a state and keeps prices as the cost", () => {
    const n = normalizePurchase({ ...base, taxAnswer: "YES_OTHER_STATE", sellerTaxCents: 700, otherState: " Utah ",
      otherChargesCents: 2500, appliances: [{ applianceTypeId: "t1", priceCents: 10000 }, { applianceTypeId: "t1", priceCents: 30000 }] });
    expect(n.otherState).toBe("Utah");
    expect(n.math.subtotalCents).toBe(40000);
    expect(n.math.receiptTotalCents).toBe(43200);
    expect(n.math.taxShares).toEqual([175, 525]);
  });
});

const subject = (patch: Partial<PurchaseTaxSubject>): PurchaseTaxSubject => ({
  label: "Washer WASH-0001", href: "/desk/inventory/a1", status: "UNKNOWN", choice: "LATER", otherStateName: null,
  otherStateTaxCents: null, recordedAt: day("2026-10-01"), purchasedOn: day("2026-10-01"), useTaxRows: [], covering: null,
  blockedReason: null, blockedHref: null, blockedLabel: null, ...patch,
});
const covering = { name: "Greeley use tax return", legalDueOn: day("2026-11-20") };

describe("W-2 nextPurchaseTaxStep gives every answer exactly one next step", () => {
  it("seller charged full tax: done, nothing to file", () => {
    const step = nextPurchaseTaxStep(subject({ status: "SALES_TAX_PAID", choice: "SELLER_CHARGED" }), day("2026-10-05"));
    expect(step).toMatchObject({ kind: "DONE_SELLER_TAX", done: true, todo: null });
  });
  it("use tax on the right return with its legal due date, from the calendar", () => {
    const step = nextPurchaseTaxStep(subject({ status: "USE_TAX_DUE", choice: "NONE_CHARGED", useTaxRows: [
      { jurisdictionName: "Greeley", status: "DUE", useTaxDueCents: 500, returnName: "Greeley use tax return", returnLegalDueOn: day("2026-11-20"), filedOn: null, confirmationNumber: null }] }), day("2026-10-05"));
    expect(step.kind).toBe("USE_TAX_ON_RETURN");
    expect(step.amountCents).toBe(500);
    expect(step.headline).toContain("$5.00");
    expect(step.headline).toContain("Nov 20, 2026");
  });
  it("use tax with no return to put it on says what to link", () => {
    const step = nextPurchaseTaxStep(subject({ status: "USE_TAX_DUE", useTaxRows: [
      { jurisdictionName: "Greeley", status: "DUE", useTaxDueCents: 500, returnName: null, returnLegalDueOn: null, filedOn: null, confirmationNumber: null }] }), day("2026-10-05"));
    expect(step.kind).toBe("USE_TAX_NO_FILING_ACCOUNT");
    expect(step.done).toBe(false);
  });
  it("use tax already filed shows the return and confirmation", () => {
    const step = nextPurchaseTaxStep(subject({ status: "USE_TAX_PAID", useTaxRows: [
      { jurisdictionName: "Greeley", status: "FILED", useTaxDueCents: 500, returnName: "Greeley use tax return", returnLegalDueOn: day("2026-11-20"), filedOn: day("2026-11-10"), confirmationNumber: "ABC123" }] }), day("2026-12-01"));
    expect(step).toMatchObject({ kind: "USE_TAX_FILED", done: true });
    expect(step.headline).toContain("ABC123");
  });
  it("tax-free for rent: rent is taxed", () => {
    expect(nextPurchaseTaxStep(subject({ status: "BOUGHT_TAX_FREE_FOR_LEASE" }), day("2026-10-05")).kind).toBe("RENT_TAXED");
  });
  it("another state's tax: a CPA To do until IN-65 is answered, never a guess", () => {
    const step = nextPurchaseTaxStep(subject({ otherStateName: "Utah", otherStateTaxCents: 700 }), day("2026-10-05"));
    expect(step.kind).toBe("CPA_OTHER_STATE");
    expect(step.todo?.title).toContain("Utah");
    expect(step.detail).toContain("Nothing is calculated");
  });
  it("later: a To do 3 days after it was recorded that turns high 7 days before the covering return's due date", () => {
    const early = nextPurchaseTaxStep(subject({ covering }), day("2026-10-05"));
    expect(early.kind).toBe("CHECK_RECEIPT_LATER");
    expect(early.todo?.severity).toBe("medium");
    expect(early.todo?.dueOn).toEqual(day("2026-10-04"));
    expect(early.headline).toContain("Nov 20, 2026");
    const justBefore = nextPurchaseTaxStep(subject({ covering }), day("2026-11-12"));
    expect(justBefore.todo?.severity).toBe("medium");
    const urgent = nextPurchaseTaxStep(subject({ covering }), day("2026-11-13"));
    expect(urgent.todo?.severity).toBe("high");
  });
  it("blocked setup is named with where to fix it, not hidden", () => {
    const step = nextPurchaseTaxStep(subject({ choice: "NONE_CHARGED", blockedReason: "BUSINESS_ADDRESS_UNVERIFIED", blockedLabel: "Confirm business address" }), day("2026-10-05"));
    expect(step.kind).toBe("NEEDS_SETUP");
    expect(step.headline).toBe("Confirm business address.");
  });
});

describe("W-15 audit pack spreadsheet", () => {
  const pack: AuditPack = {
    from: "2026-01-01", to: "2026-12-31", generatedAt: new Date(), undatedAppliances: 0,
    totals: { priceCents: 0, sellerTaxPaidCents: 0, useTaxReportedCents: 0, useTaxDueCents: 0 },
    rows: [{
      kind: "Appliance", assetNumber: "WASH-0001", item: "Washer", manufacturer: "=HYPERLINK(\"x\")", model: "M1", serial: "SN1", seller: "Acme, Inc.",
      purchasedOn: day("2026-10-01"), receiptNumber: "R-1", priceCents: 12345, sellerTaxPaidCents: 100, useTaxReportedCents: 0, useTaxDueCents: 0,
      returnName: "", periodLabel: "", filedOn: null, confirmationNumber: "", outcome: "ok", receipts: [{ label: "Receipt page 1", href: "/api/photos/p1" }], recordHref: "/desk/inventory/a1",
    }],
  };
  it("keeps the same columns in the same order, writes dollars, and never lets text run as a formula", () => {
    const [header, row] = auditPackCsv(pack).trim().split("\r\n");
    expect(header!.split(",")).toEqual([...AUDIT_PACK_COLUMNS].map((c) => (c.includes(",") ? `"${c}"` : c)));
    expect(row).toContain("123.45");
    expect(row).toContain("\"Acme, Inc.\"");
    expect(row).toContain("'=HYPERLINK");
    expect(row).toContain("/api/photos/p1");
  });
  it("defaults to the year so far and refuses impossible or reversed dates", () => {
    expect(parseAuditRange(undefined, "2026-10-17")).toEqual({ from: "2026-01-01", to: "2026-10-17" });
    expect(parseAuditRange("2026-02-30", "2026-03-01")).toHaveProperty("error");
    expect(parseAuditRange("2026-05-01", "2026-04-01")).toHaveProperty("error");
  });
});
