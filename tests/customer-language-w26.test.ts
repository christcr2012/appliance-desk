import { describe, expect, it } from "vitest";
import { customerLanguageActive, customerStrings, customerText, parseCustomerLanguage } from "@/domains/language/copy";

describe("W-26 customer language", () => {
  it("only supports the two approved customer languages, failing unknown values to English", () => {
    expect(parseCustomerLanguage("es")).toBe("es");
    expect(parseCustomerLanguage("en")).toBe("en");
    expect(parseCustomerLanguage("pt")).toBe("en");
    expect(parseCustomerLanguage(null)).toBe("en");
  });

  it("fails closed while Spanish review/activation is pending", () => {
    expect(customerLanguageActive("es", false)).toBe("en");
    expect(customerLanguageActive("es", true)).toBe("es");
    expect(customerLanguageActive("en", true)).toBe("en");
  });

  it("has an identical complete customer-facing keyset in both languages", () => {
    expect(Object.keys(customerStrings.es).sort()).toEqual(Object.keys(customerStrings.en).sort());
    for (const key of Object.keys(customerStrings.en) as (keyof typeof customerStrings.en)[]) {
      expect(customerText("es", key).trim()).not.toBe("");
      expect(customerText("en", key).trim()).not.toBe("");
    }
  });

  it("keeps English legally controlling and never presents draft translation as authorized", () => {
    expect(customerText("es", "termsEnglish")).toContain("inglés");
    expect(customerText("en", "termsEnglish")).toContain("English");
  });
});

// Signing-language evidence uses the same read-only EN/ES domain contract;
// the write is performed only by the winning signature compare-and-set.
describe("W-26 signed-language invariant", () => {
  it("keeps language preference separate from legally authorized signing language", () => {
    const preferredLanguage = parseCustomerLanguage("es");
    const actualLegalLanguage = customerLanguageActive(preferredLanguage, false);
    expect(actualLegalLanguage).toBe("en");
    expect(preferredLanguage).toBe("es");
  });
});
