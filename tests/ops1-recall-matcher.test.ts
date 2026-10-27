import { describe, expect, it } from "vitest";
import { CPSC_SAMPLE } from "./fixtures/ops1-cpsc-sample";
import { matchRecallToAppliance, modelKey, nameWords, parseCpscRecalls, sameMaker } from "@/domains/recalls/matcher";
import {
  CPSC_PARAMETER_NAMES, collectMatches, fleetSearches, nightlySearches, termsForType, type FleetUnit,
} from "@/domains/recalls/plan";
import { draftRenterMessage, renterTaskNote } from "@/domains/recalls/drafts";

const recalls = parseCpscRecalls(CPSC_SAMPLE);

describe("OPS-1 reading the government's answer", () => {
  it("keeps real records, skips ones with no identity, and never trusts a link outside the government's sites", () => {
    expect(recalls.map((r) => r.recallNumber)).toEqual(["99-001", "99-002"]);
    expect(recalls[0]!.url).toBe("https://www.cpsc.gov/Recalls/2026/Testmaker-Recalls-Retro-Refrigerators");
    expect(recalls[1]!.url).toBe("https://www.cpsc.gov/Recalls");
    expect(recalls[0]!.remedy).toContain("free repair kit");
    expect(recalls[0]!.publishedAt?.toISOString().slice(0, 10)).toBe("2026-07-30");
  });
  it("returns nothing for an answer that is not a list", () => {
    expect(parseCpscRecalls({ error: "x" })).toEqual([]);
    expect(parseCpscRecalls(null)).toEqual([]);
  });
});

describe("OPS-1 maker and model matching", () => {
  it("compares makers by whole words without company endings", () => {
    expect(nameWords("Testmaker Appliance Co., Ltd.")).toEqual(["testmaker", "appliance"]);
    expect(sameMaker("Testmaker", "Testmaker Appliance Co., Ltd.")).toBe(true);
    expect(sameMaker("GE", "Gerber Products")).toBe(false);
    expect(sameMaker("Whirlpool", "Whirlpool Corporation")).toBe(true);
    expect(sameMaker("", "Whirlpool")).toBe(false);
  });
  it("matches the maker AND a model found in the notice", () => {
    const result = matchRecallToAppliance(recalls[0]!, { manufacturer: "Testmaker", model: "tm rr10" });
    expect(result?.reason).toContain("appears in the recall notice");
  });
  it("does not match when the maker matches but the model is not in the notice", () => {
    expect(matchRecallToAppliance(recalls[0]!, { manufacturer: "Testmaker", model: "TM-ZZ99" })).toBeNull();
  });
  it("matches as possible when the maker matches and no model is on file", () => {
    const result = matchRecallToAppliance(recalls[0]!, { manufacturer: "Testmaker", model: null });
    expect(result?.reason).toContain("No model number is on file");
  });
  it("never matches a machine with no maker, or a different maker", () => {
    expect(matchRecallToAppliance(recalls[0]!, { manufacturer: null, model: "TM-RR10" })).toBeNull();
    expect(matchRecallToAppliance(recalls[0]!, { manufacturer: "Washwell", model: "TM-RR10" })).toBeNull();
  });
  it("ignores a model too short to be meaningful", () => {
    expect(modelKey("A-1")).toBe("A1");
    expect(matchRecallToAppliance(recalls[0]!, { manufacturer: "Testmaker", model: "A1" })).toBeNull();
  });
});

describe("OPS-1 what we ask the government's list", () => {
  const fleet: FleetUnit[] = [
    { id: "a1", manufacturer: "Testmaker", model: "TM-RR10", applianceTypeId: "t-fridge", terms: ["refrigerator"] },
    { id: "a2", manufacturer: "Washwell", model: "WW-4400", applianceTypeId: "t-washer", terms: ["washer", "washing machine"] },
    { id: "a3", manufacturer: "washwell", model: null, applianceTypeId: "t-washer", terms: ["washer", "washing machine"] },
    { id: "a4", manufacturer: null, model: null, applianceTypeId: "t-washer", terms: ["washer", "washing machine"] },
  ];
  it("uses the type's own words, or its name when none were set", () => {
    expect(termsForType({ name: "Washer", recallProductTerms: [" Washer ", "washing machine", ""] })).toEqual(["washer", "washing machine"]);
    expect(termsForType({ name: "Mini Fridge", recallProductTerms: [] })).toEqual(["mini fridge"]);
  });
  it("sends only parameter names the government's list knows (a misspelled name returns everything)", () => {
    const searches = [...nightlySearches(fleet, new Date("2026-10-20T12:00:00Z")), ...fleetSearches(fleet, new Date("2026-10-26T12:00:00Z"))];
    expect(searches.length).toBeGreaterThan(0);
    for (const search of searches) {
      const url = new URL(search.url);
      expect(url.origin + url.pathname).toBe("https://www.saferproducts.gov/RestWebServices/Recall");
      for (const name of url.searchParams.keys()) expect(CPSC_PARAMETER_NAMES).toContain(name as (typeof CPSC_PARAMETER_NAMES)[number]);
      expect(url.searchParams.get("format")).toBe("json");
    }
  });
  it("nightly: one search per word, since a day before the last good run", () => {
    const searches = nightlySearches(fleet, new Date("2026-10-20T12:00:00Z"));
    expect(searches.map((s) => new URL(s.url).searchParams.get("ProductName"))).toEqual(["refrigerator", "washer", "washing machine"]);
    expect(new URL(searches[0]!.url).searchParams.get("LastPublishDateStart")).toBe("2026-10-19");
  });
  it("whole fleet: each distinct maker with each word, 15 years back, never for a machine with no maker", () => {
    const searches = fleetSearches(fleet, new Date("2026-10-26T12:00:00Z"));
    const asked = searches.map((s) => `${new URL(s.url).searchParams.get("Manufacturer")}|${new URL(s.url).searchParams.get("ProductName")}`);
    expect(asked).toEqual(["Testmaker|refrigerator", "Washwell|washer", "Washwell|washing machine"]);
    expect(new URL(searches[0]!.url).searchParams.get("RecallDateStart")).toBe("2011-10-26");
    expect(searches.find((s) => s.key.includes("washwell|washer"))!.applianceIds.sort()).toEqual(["a2", "a3"]);
  });
  it("matches only the machines a search was for, once per recall and machine", () => {
    const searches = nightlySearches(fleet, new Date("2026-10-20T12:00:00Z"));
    const fridge = searches.find((s) => s.key === "nightly:refrigerator")!;
    const washer = searches.find((s) => s.key === "nightly:washer")!;
    const planned = collectMatches(
      [{ search: fridge, recalls }, { search: fridge, recalls }, { search: washer, recalls }],
      fleet,
    );
    // The refrigerator recall matches the Testmaker fridge; the washing-machine recall matches only machines in the washer search.
    expect(planned.map((m) => `${m.recall.recallNumber}:${m.applianceId}`).sort()).toEqual(["99-001:a1", "99-002:a2", "99-002:a3"]);
  });
});

describe("OPS-1 drafted notes", () => {
  it("writes a To do note and a customer message in the business's name, and the message never claims it was sent", () => {
    expect(renterTaskNote({ customerName: "Pat Lee", assetNumber: "R-0007", title: "Testmaker Recalls Retro Refrigerators" })).toBe(
      "Contact Pat Lee: swap or repair R-0007 (recall: Testmaker Recalls Retro Refrigerators)",
    );
    const text = draftRenterMessage({ customerName: "Pat Lee", applianceLabel: "Testmaker refrigerator", title: "T", remedy: "a free repair kit", url: "https://www.cpsc.gov/Recalls/x" });
    expect(text).toContain("Robinson Appliance Rentals");
    expect(text).toContain("a free repair kit");
    expect(text).toContain("at no cost to you");
  });
});
