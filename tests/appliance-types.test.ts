import { describe, it, expect } from "vitest";
import { slugify } from "@/domains/settings";

// slugify is what turns the name an owner types into "Add an appliance
// type" (src/app/desk/settings/appliance-pricing-table.tsx) into the
// unique, URL/database-safe slug ApplianceType.slug requires — see
// docs/BUSINESS-RULES.md ("new appliance categories are added as
// data"). Getting this wrong either breaks the unique constraint or
// silently produces an empty/garbage slug.
describe("slugify", () => {
  it("lowercases and hyphenates a simple name", () => {
    expect(slugify("Refrigerator")).toBe("refrigerator");
  });

  it("collapses spaces and punctuation into single hyphens", () => {
    expect(slugify("Mini Fridge")).toBe("mini-fridge");
    expect(slugify("Washer + Dryer Set")).toBe("washer-dryer-set");
    expect(slugify("Dish/Washer!!")).toBe("dish-washer");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  Range  ")).toBe("range");
    expect(slugify("-Freezer-")).toBe("freezer");
  });

  it("returns an empty string for a name with no letters or numbers", () => {
    expect(slugify("!!!")).toBe("");
  });
});
