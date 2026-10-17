import { describe, expect, it } from "vitest";
import { checkServiceArea, normalizeZip } from "@/domains/site-content/service-area-check";

const area = { cities: ["Greeley", "Windsor"], zips: ["80634", "80631", " 80550 "] };

describe("normalizeZip", () => {
  it("accepts five digits and ZIP+4, trims, and refuses anything else", () => {
    expect(normalizeZip("80634")).toBe("80634");
    expect(normalizeZip(" 80634-1234 ")).toBe("80634");
    expect(normalizeZip("80634 1234")).toBe("80634");
    for (const bad of ["", "8063", "806345", "abcde", "80634-12", "80 634"]) expect(normalizeZip(bad), bad).toBeNull();
  });
});

describe("checkServiceArea", () => {
  it("says SERVED for a listed ZIP code, whatever the spacing", () => {
    expect(checkServiceArea({ line1: "123 Main St", zip: "80634" }, area)).toEqual({ status: "SERVED", zip: "80634" });
    expect(checkServiceArea({ line1: "  123   Main St ", zip: " 80550-0001 " }, area)).toEqual({ status: "SERVED", zip: "80550" });
  });
  it("says NOT_YET for a ZIP code the owner does not list", () => {
    expect(checkServiceArea({ line1: "9 Elm Ave", zip: "80202" }, area)).toEqual({ status: "NOT_YET", zip: "80202" });
  });
  it("says INVALID without a usable street address or a five-digit ZIP code", () => {
    expect(checkServiceArea({ line1: "", zip: "80634" }, area).status).toBe("INVALID");
    expect(checkServiceArea({ line1: "  ", zip: "80634" }, area).status).toBe("INVALID");
    expect(checkServiceArea({ line1: "12", zip: "80634" }, area).status).toBe("INVALID");
    expect(checkServiceArea({ line1: "123 Main St", zip: "8063" }, area).status).toBe("INVALID");
  });
  it("falls back to the city list only when the owner lists no ZIP codes", () => {
    const citiesOnly = { cities: ["Greeley"], zips: [] };
    expect(checkServiceArea({ line1: "1 A St", zip: "80634", city: " greeley " }, citiesOnly)).toMatchObject({ status: "SERVED", city: "greeley" });
    expect(checkServiceArea({ line1: "1 A St", zip: "80634", city: "Denver" }, citiesOnly).status).toBe("NOT_YET");
    expect(checkServiceArea({ line1: "1 A St", zip: "80634" }, citiesOnly).status).toBe("NOT_YET");
    // A listed-ZIP area never says yes because of a city name.
    expect(checkServiceArea({ line1: "1 A St", zip: "80202", city: "Greeley" }, area).status).toBe("NOT_YET");
  });
});
