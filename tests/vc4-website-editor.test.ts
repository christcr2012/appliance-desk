import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ role: null as string | null }));
vi.mock("@/lib/session", () => ({
  getServerSession: async () => (session.role ? { user: { id: "u1", role: session.role } } : null),
  requireRole: async (...roles: string[]) => {
    if (!session.role || !roles.includes(session.role)) throw new Error("NOT_ALLOWED");
    return { user: { id: "u1", role: session.role } };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const domain = vi.hoisted(() => ({
  saveDraft: vi.fn(), publishDraft: vi.fn(), restoreRevisionToDraft: vi.fn(), discardDraft: vi.fn(),
}));
const reads = vi.hoisted(() => ({ live: vi.fn(), draft: vi.fn() }));
vi.mock("@/domains/site-content/index", () => ({
  ...domain,
  STALE_DRAFT_MESSAGE: "Someone else changed this draft. Reload to see their changes.",
  STALE_LIVE_MESSAGE: "The live website changed after you started reviewing. Reload and review the changes again before publishing.",
  getPublishedContent: async () => ({ marker: "LIVE-TEXT" }),
  getPublishedValues: async () => ({}),
  getRevisionContent: async (id: string) => { reads.draft(id); return { marker: "DRAFT-TEXT" }; },
  getRevisionValues: async () => ({}),
}));

import { deskMoreLinks } from "@/lib/desk-navigation";
import { SITE_FIELDS, siteFieldSpec } from "@/domains/site-content/fields";
import { WEBSITE_PAGES, pageForRegistryPage, sectionsOfPage, sharedPlaces } from "@/domains/site-content/pages";
import { diffValues, factsUsed, pagesAffected, summarizeValue, changeKindName } from "@/domains/site-content/review";
import { markContent, markText, readMarks, MARK_ANY } from "@/domains/site-content/preview-markers";
import { denverLocalToUtc, utcToDenverLocal } from "@/domains/site-content/promotions";
import { editorFields } from "@/domains/site-content/editor-fields";
import { getSiteForRequest } from "@/domains/site-content/request";
import { siteDefaultTypedValues } from "@/domains/site-content/fields";
import type { SiteValue } from "@/domains/site-content/types";
import { discardDraftAction, publishWebsiteAction, restoreToDraftAction, saveWebsiteValuesAction } from "@/app/desk/settings/website/actions";
import { GET as previewGet } from "@/app/website-preview/route";
import { NextRequest } from "next/server";

beforeEach(() => { session.role = null; vi.clearAllMocks(); });

describe("the Website screen is for owners and admins", () => {
  it("is in the More list for owner and admin, and for nobody else", () => {
    for (const role of ["OWNER", "ADMIN"]) expect(deskMoreLinks(role).map((l) => l.href)).toContain("/desk/settings/website");
    for (const role of ["STAFF", "CUSTOMER", undefined]) expect(deskMoreLinks(role).map((l) => l.href)).not.toContain("/desk/settings/website");
  });

  it("refuses every action for staff, customers and signed-out visitors before touching the website", async () => {
    for (const role of ["STAFF", "CUSTOMER", null]) {
      session.role = role;
      await expect(saveWebsiteValuesAction({ values: {} })).rejects.toThrow("NOT_ALLOWED");
      await expect(publishWebsiteAction({ draftId: "d", version: 1, liveRevisionId: null })).rejects.toThrow("NOT_ALLOWED");
      await expect(restoreToDraftAction({ revisionId: "r" })).rejects.toThrow("NOT_ALLOWED");
      await expect(discardDraftAction({ draftId: "d", version: 1 })).rejects.toThrow("NOT_ALLOWED");
    }
    for (const fn of Object.values(domain)) expect(fn).not.toHaveBeenCalled();
  });

  it("passes the reviewed live version to publish and returns plain sentences for problems", async () => {
    session.role = "ADMIN";
    domain.publishDraft.mockResolvedValueOnce({ version: 7, alreadyLive: false });
    await expect(publishWebsiteAction({ draftId: "d1", version: 3, liveRevisionId: "live1" })).resolves.toEqual({ status: "published", version: 7, alreadyLive: false });
    expect(domain.publishDraft).toHaveBeenCalledWith("u1", "d1", 3, "live1");

    domain.publishDraft.mockRejectedValueOnce(new Error("The live website changed after you started reviewing. Reload and review the changes again before publishing."));
    const stale = await publishWebsiteAction({ draftId: "d1", version: 3, liveRevisionId: "live1" });
    expect(stale).toMatchObject({ status: "error", stale: true });

    domain.publishDraft.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.1:5432 secret-host"));
    const hidden = await publishWebsiteAction({ draftId: "d1", version: 3, liveRevisionId: "live1" });
    expect(hidden).toMatchObject({ status: "error" });
    expect(JSON.stringify(hidden)).not.toContain("ECONNREFUSED");
  });

  it("keeps a field problem's own plain words when a save is refused", async () => {
    session.role = "OWNER";
    domain.saveDraft.mockRejectedValueOnce(new Error("Introduction is too long: 2000 characters at most."));
    const refused = await saveWebsiteValuesAction({ values: { "how.intro": { kind: "text", text: "x" } } });
    expect(refused).toEqual({ status: "error", message: "Introduction is too long: 2000 characters at most." });
  });
});

describe("pages as the owner knows them", () => {
  it("gives every editor item a page, and every page a distinct id", () => {
    expect(new Set(WEBSITE_PAGES.map((p) => p.id)).size).toBe(WEBSITE_PAGES.length);
    for (const f of SITE_FIELDS) expect(pageForRegistryPage(siteFieldSpec(f.key)!.page), f.key).toBeDefined();
    const total = WEBSITE_PAGES.reduce((n, p) => n + sectionsOfPage(p).reduce((m, s) => m + s.fields.length, 0), 0);
    expect(total).toBe(SITE_FIELDS.length);
  });
  it("describes each item for the editor with where it appears and whether it is shared", () => {
    const fields = editorFields();
    expect(fields).toHaveLength(SITE_FIELDS.length);
    for (const f of fields) {
      expect(f.where.length, f.key).toBeGreaterThan(3);
      expect(f.help.length, f.key).toBeGreaterThan(3);
    }
    expect(sharedPlaces(siteFieldSpec("site.banner.promotion")!).join(" ")).toMatch(/Every page/);
  });
});

describe("review: exactly what publishing would change", () => {
  const defaults = siteDefaultTypedValues();
  const text = (t: string): SiteValue => ({ kind: "text", text: t });

  it("sees no change when words are put back to the starting words", () => {
    expect(diffValues({ ...defaults }, { ...defaults, "how.intro": defaults["how.intro"] })).toEqual([]);
  });
  it("lists changed, added and hidden items with before and after, link destinations and pages affected", () => {
    const live = { ...defaults };
    const draft: Record<string, SiteValue> = {
      ...defaults,
      "how.intro": text("New intro, call {phone}"),
      "header.cta.live": { kind: "link", label: "Ask us", target: { type: "external", url: "https://example.com/x" } },
      "home.feature.promotion": { kind: "hidden" },
    };
    const changes = diffValues(live, draft);
    expect(changes.map((c) => c.key).sort()).toEqual(["header.cta.live", "how.intro"].sort());
    const link = changes.find((c) => c.key === "header.cta.live")!;
    expect(link.after).toMatchObject({ kind: "link", label: "Ask us", destination: "Another website: https://example.com/x" });
    expect(changeKindName(link)).toBe("Changed");
    expect(pagesAffected(changes).map((p) => p.pageName)).toContain("How it works");
    expect(factsUsed(changes, { phone: "970-555-0100" })).toEqual([{ placeholder: "phone", label: "Phone number", value: "970-555-0100" }]);
  });
  it("summarizes a picture and a promotion without exposing anything but what the owner set", () => {
    const image = summarizeValue({ kind: "image", assetId: "abc12345", alt: "A washer", decorative: false, focalX: 10, focalY: 90 });
    expect(image).toMatchObject({ kind: "image", alt: "A washer", focalX: 10 });
    const promo = summarizeValue({ kind: "promotion", title: "Sale", body: "", enabled: true, startsAtUtc: "2026-11-01T06:00:00.000Z" });
    expect(promo).toMatchObject({ kind: "promotion", title: "Sale", enabled: true });
  });
});

describe("Colorado time boxes", () => {
  it("reads an instant back as the Colorado date and time that made it, across both daylight-saving edges", () => {
    for (const [date, time] of [["2026-11-01", "00:00"], ["2026-11-01", "23:59"], ["2026-03-08", "01:59"], ["2026-03-08", "03:00"], ["2026-07-04", "12:30"], ["2026-12-25", "08:15"]] as const) {
      const utc = denverLocalToUtc(date, time)!;
      expect(utcToDenverLocal(utc), `${date} ${time}`).toEqual({ date, time });
    }
    expect(utcToDenverLocal(undefined)).toEqual({ date: "", time: "" });
    expect(denverLocalToUtc("2026-03-08", "02:30")).toBeNull();
  });
});

describe("select-to-edit marks", () => {
  it("round-trips the item key and never leaves a mark behind", () => {
    const marked = markText("how.intro", "Hello there");
    expect(marked).not.toBe("Hello there");
    expect(readMarks(marked)).toEqual({ text: "Hello there", keys: ["how.intro"] });
    expect(marked.replace(MARK_ANY, "")).not.toContain("how.intro");
  });
  it("marks only words and button labels, not links' destinations or pictures", () => {
    const out = markContent({ "how.intro": "A" }, {
      "header.cta.live": { kind: "link", label: "Quote", target: { type: "page", path: "/contact" } },
      "home.hero.image": { kind: "image", assetId: "abc12345", alt: "alt text", decorative: false, focalX: 50, focalY: 50 },
    });
    const link = out.values["header.cta.live"];
    expect(link.kind === "link" && readMarks(link.label).keys).toEqual(["header.cta.live"]);
    expect(link.kind === "link" && link.target).toEqual({ type: "page", path: "/contact" });
    expect(out.values["home.hero.image"]).toMatchObject({ alt: "alt text", assetId: "abc12345" });
  });
});

describe("visitors never receive draft data", () => {
  it("ignores revision, previewAt and select for anyone who is not an owner or admin", async () => {
    for (const role of [null, "STAFF", "CUSTOMER"]) {
      session.role = role;
      const site = await getSiteForRequest({ revision: "draftrevision1", previewAt: "2030-01-01T00:00:00Z", select: "1" });
      expect(site.text).toEqual({ marker: "LIVE-TEXT" });
      expect(site.preview).toBe(false);
      expect(site.selectable).toBe(false);
      expect(site.revisionId).toBeUndefined();
      expect(site.now.getUTCFullYear()).toBeLessThan(2030);
    }
    expect(reads.draft).not.toHaveBeenCalled();
  });
  it("marks the words only for an owner or admin who asked to select", async () => {
    session.role = "OWNER";
    const plain = await getSiteForRequest({ revision: "draftrevision1" });
    expect(plain.text.marker).toBe("DRAFT-TEXT");
    expect(plain.selectable).toBe(false);
    const chosen = await getSiteForRequest({ revision: "draftrevision1", select: "1" });
    expect(chosen.selectable).toBe(true);
    expect(readMarks(chosen.text.marker).text).toBe("DRAFT-TEXT");
  });
});

describe("the preview door", () => {
  const call = (query: string) => previewGet(new NextRequest(`https://desk.example.test/website-preview?${query}`));
  it("tells anyone but an owner or admin that there is nothing here", async () => {
    for (const role of [null, "STAFF", "CUSTOMER"]) {
      session.role = role;
      const response = await call("path=/&revision=draftrevision1");
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toMatch(/draft|revision/i);
    }
  });
  it("sends an owner to the real page with the select switch on, and refuses odd pages, versions and dates", async () => {
    session.role = "OWNER";
    const ok = await call("path=/pricing&revision=draftrevision1&previewAt=2026-11-01T06:00Z");
    expect(ok.status).toBe(307);
    const target = new URL(ok.headers.get("location")!);
    expect(target.pathname).toBe("/pricing");
    expect(target.searchParams.get("revision")).toBe("draftrevision1");
    expect(target.searchParams.get("select")).toBe("1");
    expect((await call("path=/desk/billing&revision=draftrevision1")).status).toBe(400);
    expect((await call("path=//evil.example&revision=draftrevision1")).status).toBe(400);
    expect((await call("path=/&revision=../../etc")).status).toBe(400);
    expect((await call("path=/&previewAt=tomorrow")).status).toBe(400);
    expect((await call("path=/rent/greeley&revision=draftrevision1")).status).toBe(307);
  });
});
