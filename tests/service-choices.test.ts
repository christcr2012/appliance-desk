import { describe, expect, it } from "vitest";
import {
  computeServiceChoiceOffers,
  defaultServiceChoice,
  serviceCategoriesForOrder,
} from "@/domains/orders/service-choices";

const ALLOWED = ["WASHER", "DRYER_ELECTRIC", "FRIDGE", "FREEZER"];

function offers(overrides: Partial<Parameters<typeof computeServiceChoiceOffers>[0]> = {}) {
  return computeServiceChoiceOffers({
    deliveryPriceCents: 7500,
    pickupOnly: false,
    installationFeeCents: 4000,
    removalFeeCents: 0,
    haulAwayFeeCents: null,
    categories: ["WASHER"],
    selfInstallAllowedCategories: ALLOWED,
    ...overrides,
  });
}

describe("FEETAX-1 service choice offers", () => {
  it("offers delivery with the pickup alternative and the shown price", () => {
    const delivery = offers().find((o) => o.service === "DELIVERY");
    expect(delivery).toMatchObject({ priceCents: 7500, alternativeShown: true, alternative: "PICKUP" });
  });

  it("omits delivery when the order has no deliverable address", () => {
    expect(offers({ deliveryPriceCents: null }).some((o) => o.service === "DELIVERY")).toBe(false);
  });

  it("shows self-install when every appliance is allowed", () => {
    const install = offers({ categories: ["WASHER", "DRYER_ELECTRIC"] })
      .find((o) => o.service === "INSTALLATION");
    expect(install?.alternativeShown).toBe(true);
    expect(install?.alternative).toBe("SELF_INSTALL");
  });

  it("never shows self-install when a gas dryer is on the order", () => {
    const install = offers({ categories: ["WASHER", "DRYER_GAS"] })
      .find((o) => o.service === "INSTALLATION");
    expect(install?.alternativeShown).toBe(false);
    expect(install?.alternative).toBeNull();
  });

  it("hides self-install when the dryer's fuel is unknown", () => {
    const install = offers({ categories: ["DRYER_UNKNOWN"] })
      .find((o) => o.service === "INSTALLATION");
    expect(install?.alternativeShown).toBe(false);
  });

  it("always offers pickup at the end with the return-it-yourself alternative", () => {
    const removal = offers().find((o) => o.service === "REMOVAL");
    expect(removal).toMatchObject({ priceCents: 0, alternativeShown: true, alternative: "RETURN_IT_YOURSELF" });
  });

  it("offers haul-away only once it has a price", () => {
    expect(offers().some((o) => o.service === "HAUL_AWAY")).toBe(false);
    const haul = offers({ haulAwayFeeCents: 2500 }).find((o) => o.service === "HAUL_AWAY");
    expect(haul).toMatchObject({ priceCents: 2500, alternativeShown: true, alternative: "NO_HAUL_AWAY" });
  });

  it("defaults untouched services to by us, except delivery on a pickup order", () => {
    const [delivery] = offers();
    expect(defaultServiceChoice(delivery!, false)).toBe("BY_BUSINESS");
    expect(defaultServiceChoice(delivery!, true)).toBe("CUSTOMER_DOES_IT");
  });
});

describe("FEETAX-1 service categories for an order", () => {
  it("maps appliance types to the setting's tokens", () => {
    expect(serviceCategoriesForOrder({ applianceTypeSlugs: ["washer", "refrigerator"], dryerOutlet: null }))
      .toEqual(["WASHER", "FRIDGE"]);
  });

  it("counts a dryer as electric only on prong proof", () => {
    expect(serviceCategoriesForOrder({ applianceTypeSlugs: ["dryer"], dryerOutlet: "FOUR_PRONG" }))
      .toEqual(["DRYER_ELECTRIC"]);
    expect(serviceCategoriesForOrder({ applianceTypeSlugs: ["dryer"], dryerOutlet: "GAS" }))
      .toEqual(["DRYER_GAS"]);
    expect(serviceCategoriesForOrder({ applianceTypeSlugs: ["dryer"], dryerOutlet: "UNKNOWN" }))
      .toEqual(["DRYER_UNKNOWN"]);
    expect(serviceCategoriesForOrder({ applianceTypeSlugs: ["dryer"], dryerOutlet: null }))
      .toEqual(["DRYER_UNKNOWN"]);
  });

  it("marks unrecognized appliance types as OTHER so the alternative stays hidden", () => {
    expect(serviceCategoriesForOrder({ applianceTypeSlugs: ["range"], dryerOutlet: null }))
      .toEqual(["OTHER"]);
  });
});

// FEETAX-1 review fix: choices recorded at approval must agree with the
// frozen charges in the binding quote.
describe("assertServiceChoicesFitFrozenCharges", () => {
  it("rejects the free alternative for a service the frozen quote still charges for", async () => {
    const { assertServiceChoicesFitFrozenCharges } = await import("../src/domains/orders/service-choices");
    expect(() => assertServiceChoicesFitFrozenCharges({
      recorded: [{ service: "DELIVERY", choice: "CUSTOMER_DOES_IT" }],
      frozenChargeCents: { DELIVERY: 7500 }, pickupOnly: false,
    })).toThrow(/includes a charge for delivery/);
    expect(() => assertServiceChoicesFitFrozenCharges({
      recorded: [{ service: "INSTALLATION", choice: "CUSTOMER_DOES_IT" }],
      frozenChargeCents: { INSTALLATION: 5000 }, pickupOnly: false,
    })).toThrow(/installation/);
    expect(() => assertServiceChoicesFitFrozenCharges({
      recorded: [{ service: "REMOVAL", choice: "CUSTOMER_DOES_IT" }],
      frozenChargeCents: { REMOVAL: 4000 }, pickupOnly: false,
    })).toThrow(/pickup at the end of the rental/);
  });
  it("rejects asking for delivery on a pickup quote", async () => {
    const { assertServiceChoicesFitFrozenCharges } = await import("../src/domains/orders/service-choices");
    expect(() => assertServiceChoicesFitFrozenCharges({
      recorded: [{ service: "DELIVERY", choice: "BY_BUSINESS" }],
      frozenChargeCents: { DELIVERY: 0 }, pickupOnly: true,
    })).toThrow(/quote is for pickup/);
  });
  it("accepts choices that match the frozen charges", async () => {
    const { assertServiceChoicesFitFrozenCharges } = await import("../src/domains/orders/service-choices");
    // Self-pickup on a pickup quote; self-install when no installation is charged;
    // haul-away is never part of the frozen order.
    assertServiceChoicesFitFrozenCharges({
      recorded: [
        { service: "DELIVERY", choice: "CUSTOMER_DOES_IT" },
        { service: "INSTALLATION", choice: "CUSTOMER_DOES_IT" },
        { service: "HAUL_AWAY", choice: "BY_BUSINESS" },
      ],
      frozenChargeCents: { DELIVERY: 0, INSTALLATION: 0 }, pickupOnly: true,
    });
    assertServiceChoicesFitFrozenCharges({
      recorded: [{ service: "DELIVERY", choice: "BY_BUSINESS" }],
      frozenChargeCents: { DELIVERY: 7500 }, pickupOnly: false,
    });
  });
});
