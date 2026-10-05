import { describe, expect, it } from "vitest";
import {
  SITE_FIELDS,
  catalogAlt,
  fillSiteText,
  sanitizeSiteFields,
  siteDefaults,
} from "@/domains/site-content/fields";

describe("website text fields", () => {
  it("has unique keys, a help sentence and a label for every field", () => {
    const keys = SITE_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of SITE_FIELDS) {
      expect(f.label.length).toBeGreaterThan(2);
      expect(f.help.length).toBeGreaterThan(10);
    }
  });

  it("keeps every starting text within its own length limit and free of < >", () => {
    const result = sanitizeSiteFields(siteDefaults());
    expect(result.ok).toBe(true);
  });

  it("offers 8 question/answer pairs that start empty, so the question list is hidden", () => {
    for (let i = 1; i <= 8; i += 1) {
      expect(siteDefaults()[`faq.${i}.q`]).toBe("");
      expect(siteDefaults()[`faq.${i}.a`]).toBe("");
    }
    expect(siteDefaults()["faq.9.q"]).toBeUndefined();
  });

  it("never offers prices, phone, email, address or service area as editable text", () => {
    for (const f of SITE_FIELDS) {
      expect(f.key).not.toMatch(/price|phone|email|address|area\.cities|zip/i);
    }
  });

  it("refuses an unknown field", () => {
    const r = sanitizeSiteFields({ "home.secret": "x" });
    expect(r.ok).toBe(false);
  });

  it("removes < and > so no markup can be saved", () => {
    const r = sanitizeSiteFields({ "home.hero.heading": "Hello <script>alert(1)</script> world" });
    expect(r).toEqual({ ok: true, fields: { "home.hero.heading": "Hello scriptalert(1)/script world" } });
  });

  it("drops empty values so the page falls back to the starting text", () => {
    expect(sanitizeSiteFields({ "home.hero.heading": "   " })).toEqual({ ok: true, fields: {} });
  });

  it("enforces the length for each kind", () => {
    expect(sanitizeSiteFields({ "home.hero.heading": "a".repeat(121) }).ok).toBe(false);
    expect(sanitizeSiteFields({ "home.hero.heading": "a".repeat(120) }).ok).toBe(true);
    expect(sanitizeSiteFields({ "home.household": "a".repeat(2001) }).ok).toBe(false);
    expect(sanitizeSiteFields({ "image.hero.alt": "a".repeat(161) }).ok).toBe(false);
    expect(sanitizeSiteFields({ "seo.pricing.description": "a".repeat(161) }).ok).toBe(false);
  });

  it("keeps a heading on one line but lets a paragraph have line breaks", () => {
    expect(sanitizeSiteFields({ "home.hero.heading": "a\nb" }).ok).toBe(false);
    expect(sanitizeSiteFields({ "home.household": "a\nb" }).ok).toBe(true);
  });

  it("rejects non-text values and non-objects", () => {
    expect(sanitizeSiteFields({ "home.hero.heading": 5 }).ok).toBe(false);
    expect(sanitizeSiteFields(null).ok).toBe(false);
    expect(sanitizeSiteFields([]).ok).toBe(false);
  });

  it("fills the two placeholders and leaves unknown ones alone", () => {
    expect(fillSiteText("{businessName} — {other}", { businessName: "Acme" })).toBe("Acme — {other}");
    expect(fillSiteText("A basic {name}", { name: "washer" })).toBe("A basic washer");
  });

  it("describes a catalog photo the way the page always did unless the owner wrote something", () => {
    const d = siteDefaults();
    expect(catalogAlt(d, "washer", "Washer")).toBe(
      "A basic washer — the unit you receive may vary in brand, model, and color",
    );
    expect(catalogAlt({ ...d, "image.washer.alt": "A white front-load {name}" }, "washer", "Washer")).toBe(
      "A white front-load washer",
    );
    // A photo whose appliance has no field of its own gets the standard sentence.
    expect(catalogAlt(d, "range", "Range")).toBe(
      "A basic range — the unit you receive may vary in brand, model, and color",
    );
  });

  it("starts with today's exact home page and how-it-works wording", () => {
    const d = siteDefaults();
    expect(d["home.hero.heading"]).toBe("A clean washer & dryer, delivered — without the down payment.");
    expect(d["how.1.title"]).toBe("1. Tell us what you need");
    expect(d["contact.intro"]).toContain("we never charge anything until you've signed a rental agreement.");
  });
});
