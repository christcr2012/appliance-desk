import { describe, expect, it } from "vitest";
import { purchaseReceiptTotalCents } from "@/domains/purchasing/purchases";

// AR-6 fix 4 / spec EQUIPMENT section 9: the receipt total is one sum in
// the domain — subtotal + the seller's tax + other charges, in cents.
describe("purchaseReceiptTotalCents", () => {
  it("adds subtotal, seller tax and other charges", () => {
    expect(
      purchaseReceiptTotalCents({ subtotalCents: 120_000, sellerTaxCents: 4_800, otherChargesCents: 1_500 }),
    ).toBe(126_300);
  });

  it("handles zeros (a purchase with no tax and no other charges)", () => {
    expect(
      purchaseReceiptTotalCents({ subtotalCents: 45_000, sellerTaxCents: 0, otherChargesCents: 0 }),
    ).toBe(45_000);
  });

  it("handles an all-zero receipt", () => {
    expect(
      purchaseReceiptTotalCents({ subtotalCents: 0, sellerTaxCents: 0, otherChargesCents: 0 }),
    ).toBe(0);
  });
});
