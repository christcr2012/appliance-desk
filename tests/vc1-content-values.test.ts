import { describe, expect, it } from "vitest";
import { checkExternalUrl, linkRel, parseLinkTarget, resolveLinkHref } from "@/domains/site-content/links";
import { validateSiteValue, type ValueRules } from "@/domains/site-content/values";
import {
  collectAssetIds, decodeContentRevision, decodeOrThrow, encodeContentValues, legacyTextToValues, valueToPlainText, type FieldLookup,
} from "@/domains/site-content/codec";
import { SITE_FIELDS, SITE_FACT_SOURCES, describeSiteField, canonicalSiteKey, siteFieldSpec } from "@/domains/site-content/fields";
import { SiteContentError } from "@/domains/site-content/types";

const rules = (extra: Partial<ValueRules>): ValueRules => ({ label: "Test", valueKind: "text", optional: false, maxLength: 200, ...extra }) as ValueRules;
const synthetic: FieldLookup = (key) => {
  const table: Record<string, ValueRules> = {
    "t.text": rules({ valueKind: "text", maxLength: 20, singleLine: true }),
    "t.opt": rules({ valueKind: "text", optional: true, maxLength: 20 }),
    "t.link": rules({ valueKind: "link" }),
    "t.image": rules({ valueKind: "image", optional: true }),
    "t.promo": rules({ valueKind: "promotion", optional: true }),
  };
  return table[key] ? { rules: table[key] } : undefined;
};
const image = { kind: "image", assetId: "abcd1234", alt: "A washer", decorative: false, focalX: 40, focalY: 60 };

describe("V-C1 link targets", () => {
  it("accepts only https external addresses without credentials or tricks", () => {
    expect(checkExternalUrl("https://example.com/a").ok).toBe(true);
    for (const bad of ["http://example.com", "javascript:alert(1)", "https://u:p@example.com", "//example.com", "https://ex ample.com", "", "data:text/html,x"]) {
      expect(checkExternalUrl(bad).ok, bad).toBe(false);
    }
  });
  it("accepts known pages and city pages, refuses unknown paths", () => {
    expect(parseLinkTarget({ type: "page", path: "/pricing" }).ok).toBe(true);
    expect(parseLinkTarget({ type: "page", path: "/not-a-page" }).ok).toBe(false);
    expect(parseLinkTarget({ type: "nope" }).ok).toBe(false);
  });
  it("takes phone and email only from the business profile and marks external links safe", () => {
    expect(resolveLinkHref({ type: "phone" }, { phone: "+19705550100", email: null })).toBe("tel:+19705550100");
    expect(resolveLinkHref({ type: "email" }, { phone: null, email: "a@b.co" })).toBe("mailto:a@b.co");
    expect(resolveLinkHref({ type: "phone" }, { phone: null, email: null })).toBeNull();
    expect(linkRel({ type: "external", url: "https://example.com" })).toBe("noopener noreferrer");
    expect(linkRel({ type: "page", path: "/pricing" })).toBeUndefined();
  });
});

describe("V-C1 typed values", () => {
  it("validates images: alt, decorative, focal point range", () => {
    expect(validateSiteValue(rules({ valueKind: "image" }), image).ok).toBe(true);
    expect(validateSiteValue(rules({ valueKind: "image" }), { ...image, alt: "" }).ok).toBe(false);
    expect(validateSiteValue(rules({ valueKind: "image" }), { ...image, alt: "", decorative: true }).ok).toBe(true);
    expect(validateSiteValue(rules({ valueKind: "image" }), { ...image, focalX: 101 }).ok).toBe(false);
    expect(validateSiteValue(rules({ valueKind: "image" }), { ...image, focalX: 1.5 }).ok).toBe(false);
  });
  it("validates promotions: end after start, UTC instants", () => {
    const ok = { kind: "promotion", title: "Sale", body: "Hi", enabled: true, startsAtUtc: "2026-11-01T06:00:00.000Z", endsAtUtc: "2026-11-30T06:00:00.000Z" };
    expect(validateSiteValue(rules({ valueKind: "promotion" }), ok).ok).toBe(true);
    expect(validateSiteValue(rules({ valueKind: "promotion" }), { ...ok, endsAtUtc: "2026-10-01T06:00:00.000Z" }).ok).toBe(false);
    expect(validateSiteValue(rules({ valueKind: "promotion" }), { ...ok, startsAtUtc: "tomorrow" }).ok).toBe(false);
  });
  it("hides only optional content and rejects the wrong kind", () => {
    expect(validateSiteValue(rules({ optional: true }), { kind: "hidden" }).ok).toBe(true);
    expect(validateSiteValue(rules({}), { kind: "hidden" }).ok).toBe(false);
    expect(validateSiteValue(rules({ valueKind: "text" }), { kind: "link", label: "x", target: { type: "phone" } }).ok).toBe(false);
  });
  it("enforces text length and one-line rules and strips markup", () => {
    expect(validateSiteValue(rules({ maxLength: 5 }), { kind: "text", text: "123456" }).ok).toBe(false);
    const oneLine = validateSiteValue(rules({ singleLine: true }), { kind: "text", text: "a\nb" });
    expect(oneLine.ok && oneLine.value.kind === "text" && oneLine.value.text).toBe("a b");
    const many = validateSiteValue(rules({ singleLine: false }), { kind: "text", text: "a\nb" });
    expect(many.ok && many.value.kind === "text" && many.value.text).toBe("a\nb");
    const r = validateSiteValue(rules({}), { kind: "text", text: "Hello <b>x</b>" });
    expect(r.ok && r.value.kind === "text" && /[<>]/.test(r.value.text)).toBe(false);
  });
  it("lists allow one nesting level and unique ids", () => {
    const itemRules = rules({ valueKind: "items", itemFields: { q: rules({ valueKind: "text" }) } } as Partial<ValueRules>);
    const dup = { kind: "items", items: [{ id: "a", values: { q: { kind: "text", text: "1" } } }, { id: "a", values: { q: { kind: "text", text: "2" } } }] };
    expect(validateSiteValue(itemRules, dup).ok).toBe(false);
  });
});

describe("V-C1 codec reads version 1 and 2", () => {
  it("v1: only non-empty strings of known text fields; unknown keys are retired, not shown", () => {
    const d = decodeContentRevision(1, { "t.text": "Hi", "t.opt": "", "gone.key": "x", "t.link": "nope" }, synthetic);
    expect(d.values).toEqual({ "t.text": { kind: "text", text: "Hi" } });
    expect(d.retired).toEqual({ "gone.key": "x" });
    expect(d.problems).toEqual([]);
  });
  it("v2: keeps typed values, intentional empty and hidden", () => {
    const d = decodeContentRevision(2, { "t.opt": { kind: "text", text: "" }, "t.image": { kind: "hidden" }, "t.link": { kind: "link", label: "Call", target: { type: "phone" } } }, synthetic);
    expect(Object.keys(d.values).sort()).toEqual(["t.image", "t.link", "t.opt"]);
    expect(valueToPlainText(d.values["t.opt"])).toBe("");
    expect(valueToPlainText(d.values["t.image"])).toBe("");
    expect(valueToPlainText(d.values["t.link"])).toBeUndefined();
  });
  it("a wrong stored type is an explicit error, never [object Object]", () => {
    const d = decodeContentRevision(2, { "t.text": { ...image } }, synthetic);
    expect(d.problems).toHaveLength(1);
    expect(() => decodeOrThrow(2, { "t.text": { ...image } }, synthetic)).toThrow(SiteContentError);
  });
  it("an unsupported version throws", () => {
    expect(() => decodeContentRevision(3, {}, synthetic)).toThrow(SiteContentError);
  });
  it("encode refuses unknown keys; legacy text treats empty as not set", () => {
    expect(encodeContentValues({ nope: { kind: "text", text: "x" } }, synthetic).ok).toBe(false);
    expect(encodeContentValues({ "t.text": { kind: "text", text: "ok" } }, synthetic).ok).toBe(true);
    expect(legacyTextToValues({ a: "x", b: "  " })).toEqual({ a: { kind: "text", text: "x" } });
  });
  it("collects pictures inside lists and promotions", () => {
    const values = {
      a: { ...image },
      b: { kind: "promotion", title: "t", body: "b", enabled: true, image: { ...image, assetId: "zzz" } },
      c: { kind: "items", items: [{ id: "1", values: { p: { ...image, assetId: "mmm" } } }] },
    } as never;
    expect(collectAssetIds(values)).toEqual(["abcd1234", "mmm", "zzz"]);
  });
});

describe("V-C1 registry", () => {
  it("every existing field has complete metadata and maps to itself", () => {
    for (const field of SITE_FIELDS) {
      const spec = describeSiteField(field);
      expect(spec.label.length, field.key).toBeGreaterThan(0);
      expect(spec.help.length, field.key).toBeGreaterThan(0);
      expect(spec.where.length, field.key).toBeGreaterThan(0);
      expect(canonicalSiteKey(field.key)).toBe(field.key);
      expect(siteFieldSpec(field.key)).toBeDefined();
    }
  });
  it("business facts are declared with a source to edit them", () => {
    expect(SITE_FACT_SOURCES.length).toBeGreaterThanOrEqual(8);
    for (const source of SITE_FACT_SOURCES) expect(source.editHref).toMatch(/^\/desk\//);
  });
});
