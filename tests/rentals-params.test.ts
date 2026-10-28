import { describe, expect, it } from "vitest";
import { parseRentalsParams, rentalsHref } from "@/app/desk/agreements/params";

// AR-4a / RENTALS spec section 2 + section 7: defaults, legacy upper-case
// statuses, presets, and the ignored ?page=.
describe("parseRentalsParams", () => {
  it("defaults to the active tab, newest first", () => {
    expect(parseRentalsParams({})).toEqual({
      status: "active",
      starts: undefined,
      ends: undefined,
      q: undefined,
      sort: "newest",
      cursor: undefined,
    });
  });

  it("maps legacy upper-case statuses to the new tabs", () => {
    expect(parseRentalsParams({ status: "ACTIVE" }).status).toBe("active");
    expect(parseRentalsParams({ status: "AWAITING_SIGNATURE" }).status).toBe("signing");
    expect(parseRentalsParams({ status: "SCHEDULED" }).status).toBe("starting");
    expect(parseRentalsParams({ status: "DRAFT" }).status).toBe("drafts");
    expect(parseRentalsParams({ status: "ENDED" }).status).toBe("ended");
    expect(parseRentalsParams({ status: "CANCELLED" }).status).toBe("cancelled");
  });

  it("accepts the new tab values and rejects unknown ones to the default", () => {
    expect(parseRentalsParams({ status: "drafts" }).status).toBe("drafts");
    expect(parseRentalsParams({ status: "bogus" }).status).toBe("active");
    expect(parseRentalsParams({ status: "active " }).status).toBe("active");
  });

  it("keeps the Starts/Ends presets and drops anything else", () => {
    const p = parseRentalsParams({ starts: "this-week", ends: "ending-soon" });
    expect(p.starts).toBe("this-week");
    expect(p.ends).toBe("ending-soon");
    expect(parseRentalsParams({ starts: "last-year" }).starts).toBeUndefined();
    expect(parseRentalsParams({ ends: "someday" }).ends).toBeUndefined();
  });

  it("keeps known sorts, defaults unknown sorts to newest", () => {
    expect(parseRentalsParams({ sort: "ends-soonest" }).sort).toBe("ends-soonest");
    expect(parseRentalsParams({ sort: "rent-desc" }).sort).toBe("rent-desc");
    expect(parseRentalsParams({ sort: "customer-asc" }).sort).toBe("customer-asc");
    expect(parseRentalsParams({ sort: "random" }).sort).toBe("newest");
  });

  it("trims search text and ignores ?page=", () => {
    const p = parseRentalsParams({ q: "  smith  ", page: "3" });
    expect(p.q).toBe("smith");
    expect(p).not.toHaveProperty("page");
  });

  it("rentalsHref round-trips the visible state", () => {
    const href = rentalsHref(parseRentalsParams({}), {
      status: "drafts",
      q: "smith",
    });
    expect(href).toBe("/desk/agreements?status=drafts&q=smith");
  });
});
