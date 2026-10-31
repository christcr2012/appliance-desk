import { describe, expect, it } from "vitest";
import { parseFleetParams } from "@/app/desk/inventory/params";

// AR-6 section 3 / spec section 9: fleet params, including the old-link
// mapping (?status=AVAILABLE etc. land on the tab that contains them,
// ?taxStatus= maps to tax, ?page= is ignored).
describe("parseFleetParams", () => {
  it("defaults: all tab, newest sort, no filters", () => {
    expect(parseFleetParams({}, "OWNER")).toEqual({
      tab: "all",
      type: undefined,
      tax: undefined,
      q: "",
      sort: "newest",
      cursor: undefined,
    });
  });

  it("accepts the new tab values directly", () => {
    expect(parseFleetParams({ status: "ready" }, "STAFF").tab).toBe("ready");
    expect(parseFleetParams({ status: "needs-work" }, "OWNER").tab).toBe("needs-work");
  });

  it("maps old per-status links to the containing tab", () => {
    expect(parseFleetParams({ status: "AVAILABLE" }, "OWNER").tab).toBe("ready");
    expect(parseFleetParams({ status: "RENTED" }, "OWNER").tab).toBe("out");
    expect(parseFleetParams({ status: "RESERVED" }, "OWNER").tab).toBe("out");
    expect(parseFleetParams({ status: "AWAITING_PICKUP" }, "OWNER").tab).toBe("coming-back");
    expect(parseFleetParams({ status: "MAINTENANCE" }, "OWNER").tab).toBe("needs-work");
    expect(parseFleetParams({ status: "CLEANING" }, "OWNER").tab).toBe("needs-work");
    // RETIRED is in no tab (it lives on the Retired page): lands on "all".
    expect(parseFleetParams({ status: "RETIRED" }, "OWNER").tab).toBe("all");
    expect(parseFleetParams({ status: "BOGUS" }, "OWNER").tab).toBe("all");
  });

  it("maps ?taxStatus= to tax and ignores tax for STAFF", () => {
    expect(parseFleetParams({ taxStatus: "USE_TAX_DUE" }, "OWNER").tax).toBe("USE_TAX_DUE");
    expect(parseFleetParams({ tax: "UNKNOWN" }, "ADMIN").tax).toBe("UNKNOWN");
    expect(parseFleetParams({ taxStatus: "USE_TAX_DUE" }, "STAFF").tax).toBeUndefined();
    expect(parseFleetParams({ taxStatus: "ALL" }, "OWNER").tax).toBeUndefined();
  });

  it("ignores ?page= and validates sort", () => {
    const parsed = parseFleetParams({ page: "3", sort: "number" }, "OWNER");
    expect(parsed.sort).toBe("number");
    expect("page" in parsed).toBe(false);
    expect(parseFleetParams({ sort: "sideways" }, "OWNER").sort).toBe("newest");
  });
});
