import { describe, expect, it } from "vitest";
import { parseLeadsParams } from "@/app/desk/leads/params";

describe("parseLeadsParams", () => {
  it("defaults to next-up with no stage (the page applies the count-based default)", () => {
    expect(parseLeadsParams({})).toEqual({ sort: "next-up" });
  });

  it("passes explicit filters through", () => {
    expect(
      parseLeadsParams({
        stage: "quoted",
        q: "  smith ",
        owner: "me",
        area: "in",
        high: "1",
        pm: "1",
        quote: "1",
        created: "week",
        follow: "today",
        sort: "score",
        cursor: "abc",
      }),
    ).toEqual({
      stage: "quoted",
      q: "smith",
      owner: "me",
      area: "in",
      highValue: true,
      pm: true,
      hasQuote: true,
      created: "week",
      follow: "today",
      sort: "score",
      cursor: "abc",
    });
  });

  it("maps legacy ?status= to the matching stage, including lowercase", () => {
    expect(parseLeadsParams({ status: "NEW" }).stage).toBe("new");
    expect(parseLeadsParams({ status: "CONTACTED" }).stage).toBe("contacted");
    expect(parseLeadsParams({ status: "CONVERTED" }).stage).toBe("won");
    expect(parseLeadsParams({ status: "lost" }).stage).toBe("lost");
  });

  it("maps legacy ?view= awaiting-reply to quoted and no-next-task to contacted + next-up", () => {
    expect(parseLeadsParams({ view: "awaiting-reply" })).toEqual({ stage: "quoted", sort: "next-up" });
    expect(parseLeadsParams({ view: "no-next-task" })).toEqual({ stage: "contacted", sort: "next-up" });
    expect(parseLeadsParams({ view: "no-next-task", sort: "value" })).toEqual({ stage: "contacted", sort: "value" });
  });

  it("prefers an explicit stage over the legacy mapping and ignores ?page=", () => {
    expect(parseLeadsParams({ stage: "lost", status: "NEW", page: "3" })).toEqual({
      stage: "lost",
      sort: "next-up",
    });
  });

  it("leaves the stage unset when follow is set without one (no stage filter applies)", () => {
    const parsed = parseLeadsParams({ follow: "week" });
    expect(parsed.follow).toBe("week");
    expect(parsed.stage).toBeUndefined();
  });

  it("applies both stage and follow when both are present", () => {
    const parsed = parseLeadsParams({ stage: "contacted", follow: "today" });
    expect(parsed).toMatchObject({ stage: "contacted", follow: "today" });
  });

  it("collects multi values from repeated and comma-joined params, deduped", () => {
    const parsed = parseLeadsParams({ source: ["Web, Referral", "Web"], appliance: "washer,dryer" });
    expect(parsed.source).toEqual(["Web", "Referral"]);
    expect(parsed.appliance).toEqual(["washer", "dryer"]);
  });

  it("treats off toggles as absent and degrades bad values to the defaults instead of failing", () => {
    expect(parseLeadsParams({ high: "0", stage: "bogus", sort: "bogus", created: "year" })).toEqual({
      sort: "next-up",
    });
  });
});
