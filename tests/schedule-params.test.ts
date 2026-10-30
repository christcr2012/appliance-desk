import { describe, expect, it } from "vitest";
import { parseVisitsParams } from "@/app/desk/jobs/params";

describe("parseVisitsParams", () => {
  it("defaults to Upcoming, soonest first", () => {
    expect(parseVisitsParams({})).toEqual({
      tab: "upcoming",
      type: undefined,
      who: undefined,
      q: undefined,
      when: undefined,
      sort: "soonest",
      cursor: undefined,
    });
  });

  it("maps the spec's tab names", () => {
    expect(parseVisitsParams({ status: "no-time" }).tab).toBe("no-time");
    expect(parseVisitsParams({ status: "done" }).tab).toBe("done");
    expect(parseVisitsParams({ status: "cancelled" }).tab).toBe("cancelled");
  });

  it("maps old status links and ignores ?page=", () => {
    expect(parseVisitsParams({ status: "SCHEDULED" }).tab).toBe("upcoming");
    expect(parseVisitsParams({ status: "IN_PROGRESS" }).tab).toBe("upcoming");
    expect(parseVisitsParams({ status: "COMPLETED" }).tab).toBe("done");
    expect(parseVisitsParams({ status: "CANCELLED" }).tab).toBe("cancelled");
    expect(parseVisitsParams({ status: "done", page: "3" }).tab).toBe("done");
  });

  it("falls back to defaults for unknown values, never throws", () => {
    const parsed = parseVisitsParams({ status: "bogus", type: "bogus", when: "bogus", sort: "bogus" });
    expect(parsed.tab).toBe("upcoming");
    expect(parsed.type).toBeUndefined();
    expect(parsed.when).toBeUndefined();
    expect(parsed.sort).toBe("soonest");
  });

  it("maps the type words to job types", () => {
    expect(parseVisitsParams({ type: "delivery" }).type).toBe("DELIVERY");
    expect(parseVisitsParams({ type: "pickup" }).type).toBe("REMOVAL");
    expect(parseVisitsParams({ type: "repair" }).type).toBe("MAINTENANCE_VISIT");
    expect(parseVisitsParams({ type: "swap" }).type).toBe("SWAP");
    expect(parseVisitsParams({ type: "installation" }).type).toBe("INSTALLATION");
  });

  it("defaults Done and Cancelled to latest first; an explicit sort wins", () => {
    expect(parseVisitsParams({ status: "done" }).sort).toBe("latest");
    expect(parseVisitsParams({ status: "cancelled" }).sort).toBe("latest");
    expect(parseVisitsParams({ status: "done", sort: "soonest" }).sort).toBe("soonest");
    expect(parseVisitsParams({ status: "upcoming", sort: "latest" }).sort).toBe("latest");
  });

  it("passes who, q and the when presets through", () => {
    const parsed = parseVisitsParams({ who: "unassigned", q: "  ruiz ", when: "next-week" });
    expect(parsed.who).toBe("unassigned");
    expect(parsed.q).toBe("ruiz");
    expect(parsed.when).toBe("next-week");
  });
});
