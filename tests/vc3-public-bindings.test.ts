import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getServerSession: vi.fn() }));
vi.mock("@/domains/site-content/index", () => ({
  getPublishedContent: async () => ({ live: "text" }),
  getPublishedValues: async () => ({ live: { kind: "text", text: "text" } }),
  getRevisionContent: async () => ({ draft: "text" }),
  getRevisionValues: async () => ({ draft: { kind: "text", text: "text" } }),
}));

import { getServerSession } from "@/lib/session";
import { getSiteForRequest } from "@/domains/site-content/request";
import { checkInlineLinks, parseRichText, stripInlineLinks } from "@/domains/site-content/richtext";
import { denverLocalToUtc, describePromotionSchedule, livePromotion, promotionState } from "@/domains/site-content/promotions";
import { describeSiteField, fillSiteText, sanitizeSiteFields, SITE_FIELDS, siteDefaults, siteDefaultTypedValues } from "@/domains/site-content/fields";

function fieldRules(key: string) {
  const field = SITE_FIELDS.find((f) => f.key === key);
  if (!field) throw new Error(`no field ${key}`);
  return describeSiteField(field).rules;
}
const checkValue = validateSiteValue;
import { validateSiteValue } from "@/domains/site-content/values";
import { siteCopy, siteFacts } from "@/domains/site-content/facts";
import { publicNavLinks, NAV_LINKS } from "@/components/site/nav-links";
import { resolveLinkHref } from "@/domains/site-content/links";
import type { PromotionValue } from "@/domains/site-content/types";

describe("links inside sentences", () => {
  it("turns [words](/page) and [words](https://…) into links and leaves other brackets alone", () => {
    const parts = parseRichText("See [pricing](/pricing) or [them](https://example.com/x) [not a link] done", true);
    expect(parts.filter((p) => p.type === "link").map((p) => (p.type === "link" ? p.label : ""))).toEqual(["pricing", "them"]);
    expect(parts.map((p) => (p.type === "text" ? p.text : "")).join("")).toContain("[not a link]");
  });
  it("refuses unknown pages, http addresses, script addresses and addresses with sign-in details", () => {
    for (const bad of ["[x](/secret)", "[x](http://example.com)", "[x](javascript:alert(1))", "[x](https://u:p@example.com)", "[x](//evil.example)", "[x](/pricing#Bad Anchor)"]) {
      expect(checkInlineLinks(bad), bad).not.toBeNull();
    }
    expect(checkInlineLinks("[x](/rent/greeley) [y](/contact#form) [z](https://example.com/a?b=1)")).toBeNull();
  });
  it("shows a bad link as the plain words it was typed with, never as a live link", () => {
    expect(parseRichText("[x](javascript:alert(1))", true).some((p) => p.type === "link")).toBe(false);
  });
  it("removes link marks for page titles and search text", () => {
    expect(stripInlineLinks("Join [for updates](/launch).")).toBe("Join for updates.");
  });
  it("is refused when saved or published in a paragraph that allows links", () => {
    expect(sanitizeSiteFields({ "launch.question": "Ask [us](/nowhere)." }).ok).toBe(false);
    expect(sanitizeSiteFields({ "launch.question": "Ask [us](/contact)." }).ok).toBe(true);
  });
});

describe("named facts inside sentences", () => {
  it("fills only the facts the item declares, from their owner, and leaves unknown names as typed", () => {
    expect(fillSiteText("{businessName} on {phone} in {city}; {nope}", { businessName: "B", phone: "1", city: "G" })).toBe("B on 1 in G; {nope}");
  });
  it("refuses an unknown fact name when saving", () => {
    const r = sanitizeSiteFields({ "home.hero.eyebrow": "Now in {planet}" });
    expect(r.ok).toBe(false);
    expect(sanitizeSiteFields({ "home.hero.eyebrow": "Now in {city}" }).ok).toBe(true);
  });
  it("refuses an unknown fact in the words of a button", () => {
    const rules = fieldRules("home.hero.cta.primary");
    expect(checkValue(rules, { kind: "link", label: "Go {planet}", target: { type: "page", path: "/contact" } }).ok).toBe(false);
    expect(checkValue(rules, { kind: "link", label: "Go {businessName}", target: { type: "page", path: "/contact" } }).ok).toBe(true);
  });
  it("takes the late-fee days from Settings so the page can never disagree with the setting", () => {
    const facts = siteFacts({ publicBusinessName: "B", publicPhone: "1", publicEmail: "e", lateFeeGraceDays: 9 });
    expect(siteCopy(siteDefaults(), facts)("pricing.good.late.text")).toBe("a grace period of 9 days applies before any late fee.");
  });
  it("keeps prices, phone, email, address and service area out of the editable words", () => {
    for (const [key, text] of Object.entries(siteDefaults())) {
      expect(text, key).not.toMatch(/\$\s?\d|\(\d{3}\)\s?\d{3}|\d{3}[-.]\d{3}[-.]\d{4}|@[a-z0-9-]+\.[a-z]{2,}/i);
    }
  });
});

describe("buttons and navigation", () => {
  it("keeps the menu and footer destinations fixed in code while the words are editable", () => {
    const words = { ...siteDefaults(), "nav.pricing": "Costs" };
    expect(publicNavLinks(false, words).map((l) => [l.href, l.label])).toEqual([
      ["/pricing", "Costs"], ["/how-it-works", "How It Works"], ["/service-area", "Service Area"], ["/contact", "Get a Quote"],
    ]);
    expect(NAV_LINKS.map((l) => l.href)).toEqual(["/pricing", "/how-it-works", "/service-area", "/contact"]);
    expect(publicNavLinks(true, words).map((l) => l.href)).not.toContain("/pricing");
  });
  it("every menu, footer and legal word is an item that cannot be emptied", () => {
    for (const key of ["nav.pricing", "nav.howItWorks", "nav.serviceArea", "nav.contact", "footer.privacy", "footer.terms", "footer.accessibility", "header.login"]) {
      const f = SITE_FIELDS.find((x) => x.key === key);
      expect(f, key).toBeDefined();
      expect(f!.optional ?? false, key).toBe(false);
    }
  });
  it("phone and email buttons use the business profile's number and address and show nothing when there is none", () => {
    expect(resolveLinkHref({ type: "phone" }, { phone: "(970) 555-0142", email: null })).toBe("tel:9705550142");
    expect(resolveLinkHref({ type: "phone" }, { phone: "", email: null })).toBeNull();
    expect(resolveLinkHref({ type: "email" }, { phone: null, email: "a@b.co" })).toBe("mailto:a@b.co");
    expect(resolveLinkHref({ type: "email" }, { phone: null, email: "[email]" })).toBeNull();
  });
  it("starting buttons all point at known pages", () => {
    for (const v of Object.values(siteDefaultTypedValues())) {
      if (v.kind === "link" && v.target.type === "page") expect(["/", "/pricing", "/how-it-works", "/service-area", "/contact", "/launch"]).toContain(v.target.path);
    }
  });
});

describe("promotion schedule (Colorado time)", () => {
  const base: PromotionValue = { kind: "promotion", title: "t", body: "b", enabled: true };
  it("is off by default and when switched off", () => {
    expect(promotionState(undefined, new Date())).toBe("off");
    expect(promotionState({ ...base, enabled: false }, new Date())).toBe("off");
    expect(promotionState({ kind: "promotion", title: "", body: "", enabled: false }, new Date())).toBe("off");
  });
  it("shows only between start and end, and an ended one simply stops showing", () => {
    const p = { ...base, startsAtUtc: "2026-11-01T06:00:00.000Z", endsAtUtc: "2026-11-08T07:00:00.000Z" };
    expect(promotionState(p, new Date("2026-10-31T23:59:59Z"))).toBe("scheduled");
    expect(livePromotion(p, new Date("2026-10-31T23:59:59Z"))).toBeNull();
    expect(promotionState(p, new Date("2026-11-01T06:00:00Z"))).toBe("live");
    expect(promotionState(p, new Date("2026-11-08T06:59:59Z"))).toBe("live");
    expect(promotionState(p, new Date("2026-11-08T07:00:00Z"))).toBe("ended");
    expect(livePromotion(p, new Date("2026-11-09T00:00:00Z"))).toBeNull();
  });
  it("means Colorado wall-clock time across spring-forward (2027-03-14) and fall-back (2026-11-01)", () => {
    expect(denverLocalToUtc("2026-10-31", "12:00")).toBe("2026-10-31T18:00:00.000Z"); // MDT
    expect(denverLocalToUtc("2026-11-02", "12:00")).toBe("2026-11-02T19:00:00.000Z"); // MST
    expect(denverLocalToUtc("2027-03-13", "23:30")).toBe("2027-03-14T06:30:00.000Z"); // MST just before
    expect(denverLocalToUtc("2027-03-14", "03:30")).toBe("2027-03-14T09:30:00.000Z"); // MDT just after
    expect(denverLocalToUtc("2027-03-14", "02:30")).toBeNull(); // does not exist
    expect(denverLocalToUtc("2026-11-01", "01:30")).toBe("2026-11-01T07:30:00.000Z"); // ambiguous: the earlier instant
    expect(denverLocalToUtc("2026-11-01", "bad")).toBeNull();
  });
  it("describes the schedule in Colorado time for the owner", () => {
    const p = { ...base, startsAtUtc: "2026-11-01T06:00:00.000Z", endsAtUtc: "2026-11-08T07:00:00.000Z" };
    expect(describePromotionSchedule(p, new Date("2026-11-02T12:00:00Z"))).toMatch(/Visible now: starts .*12:00 AM MDT.*ends .*12:00 AM MST/);
    expect(describePromotionSchedule(p, new Date("2026-12-01T12:00:00Z"))).toMatch(/^Ended/);
  });
  it("refuses a promotion linked to a priced offer until an offer source exists", () => {
    const rules = fieldRules("site.banner.promotion");
    expect(checkValue(rules, { ...base, offerVersionId: "offer_123" }).ok).toBe(false);
    expect(checkValue(rules, base).ok).toBe(true);
    expect(checkValue(rules, { ...base, endsAtUtc: "2026-01-01T00:00:00.000Z", startsAtUtc: "2026-02-01T00:00:00.000Z" }).ok).toBe(false);
  });
});

describe("who can preview a draft", () => {
  it("lets only an owner or admin read a draft, an old version or a future moment", async () => {
    const asRole = (role: string | null) => vi.mocked(getServerSession).mockResolvedValue(role ? ({ user: { role } } as never) : null);
    asRole("OWNER");
    const owner = await getSiteForRequest({ revision: "rev1", previewAt: "2030-01-01T00:00Z" });
    expect(owner.preview).toBe(true);
    expect(owner.text).toEqual({ draft: "text" });
    expect(owner.now.toISOString()).toBe("2030-01-01T00:00:00.000Z");
    for (const role of ["STAFF", "CUSTOMER", null]) {
      asRole(role);
      const visitor = await getSiteForRequest({ revision: "rev1", previewAt: "2030-01-01T00:00Z" });
      expect(visitor.preview).toBe(false);
      expect(visitor.text).toEqual({ live: "text" });
      expect(Math.abs(visitor.now.getTime() - Date.now())).toBeLessThan(5000);
    }
    asRole(null);
    expect((await getSiteForRequest(undefined)).preview).toBe(false);
  });
});
