// Real-Postgres proof for V-C3: typed website content reaches the public request reader only after publishing,
// previews are limited to active owners and admins, and bad links, facts and offers are refused at save and publish.
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPublishedContent, getPublishedValues, publishDraft, saveDraft } from "@/domains/site-content";
import { SITE_FIELDS, siteDefaults } from "@/domains/site-content/fields";
import { findServableAsset, uploadWebsiteAsset } from "@/domains/site-content/assets";
import { MemoryAssetStore, setWebsiteAssetStoreForTests } from "@/domains/site-content/asset-store";
import { getSiteForRequest } from "@/domains/site-content/request";
import { livePromotion } from "@/domains/site-content/promotions";

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
const session = vi.hoisted(() => ({ role: null as string | null }));
vi.mock("@/lib/session", () => ({
  getServerSession: async () => (session.role ? { user: { role: session.role } } : null),
}));

const run = process.env.CI === "true";
const d = describe.skipIf(!run);

d("public website content, end to end", () => {
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: "" };
  const store = new MemoryAssetStore();

  async function clean() {
    await prisma.siteContentPointer.updateMany({ where: { id: "published" }, data: { publishedRevisionId: null } });
    await prisma.siteContentRevision.deleteMany({});
  }

  beforeAll(async () => {
    expect(["localhost", "127.0.0.1"]).toContain(new URL(process.env.DATABASE_URL!).hostname);
    const u = await prisma.user.create({ data: { name: `Owner ${tag}`, email: `owner-${tag}@example.test`, emailVerified: true, role: "OWNER" } });
    ids.owner = u.id;
    await clean();
    await prisma.siteContentPointer.upsert({ where: { id: "published" }, create: { id: "published", publishedRevisionId: null }, update: {} });
    setWebsiteAssetStoreForTests(store);
  });
  afterAll(async () => {
    setWebsiteAssetStoreForTests(null);
    await clean();
    await prisma.websiteAsset.deleteMany({ where: { createdByUserId: ids.owner } });
    await prisma.auditLog.deleteMany({ where: { userId: ids.owner } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
  });

  it("with nothing published, every public item reads its starting text and the promotion slots are off", async () => {
    session.role = null;
    const live = await getSiteForRequest(undefined);
    const textKeys = SITE_FIELDS.filter((f) => (f.valueKind ?? "text") === "text").map((f) => f.key).sort();
    expect(Object.keys(live.text).sort()).toEqual(textKeys);
    expect(live.text).toEqual(siteDefaults());
    expect(live.values["header.cta.live"]).toMatchObject({ kind: "link", label: "Get a Quote", target: { type: "page", path: "/contact" } });
    expect(livePromotion(live.values["site.banner.promotion"] as never, live.now)).toBeNull();
    expect(livePromotion(live.values["home.feature.promotion"] as never, live.now)).toBeNull();
  });

  it("refuses bad links, unknown facts and priced offers when saving", async () => {
    const bad: Record<string, unknown>[] = [
      { "launch.question": { kind: "text", text: "Ask [us](/nowhere)." } },
      { "launch.question": { kind: "text", text: "Ask [us](http://example.com)." } },
      { "home.hero.eyebrow": { kind: "text", text: "Now in {planet}" } },
      { "header.cta.live": { kind: "link", label: "Go", target: { type: "external", url: "http://example.com" } } },
      { "header.cta.live": { kind: "link", label: "Go {planet}", target: { type: "page", path: "/contact" } } },
      { "site.banner.promotion": { kind: "promotion", title: "Sale", body: "", enabled: true, offerVersionId: "offer_1" } },
    ];
    for (const values of bad) await expect(saveDraft(ids.owner, { values }), JSON.stringify(values)).rejects.toThrow();
  });

  it("a saved draft stays invisible to visitors; only an active owner previewing it sees it; publishing makes it public", async () => {
    const start = new Date(Date.now() - 3_600_000).toISOString();
    const end = new Date(Date.now() + 3_600_000).toISOString();
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 10, g: 90, b: 40 } } }).png().toBuffer();
    const assetId = (await uploadWebsiteAsset(ids.owner, png, store)).id;
    const draft = await saveDraft(ids.owner, {
      values: {
        "home.hero.heading": { kind: "text", text: "Draft heading for {businessName}" },
        "header.cta.live": { kind: "link", label: "Call us", target: { type: "phone" } },
        "launch.question": { kind: "text", text: "Questions? [Contact us](/contact)." },
        "home.hero.image": { kind: "image", assetId, alt: "A clean washer", decorative: false, focalX: 30, focalY: 70 },
        "site.banner.promotion": { kind: "promotion", title: "Fall sale", body: "Ask about it.", enabled: true, startsAtUtc: start, endsAtUtc: end },
        "home.feature.promotion": { kind: "promotion", title: "Later", body: "", enabled: true, startsAtUtc: end },
      },
    });

    session.role = null;
    expect((await getSiteForRequest({ revision: draft.draftId })).text["home.hero.heading"]).toBe(siteDefaults()["home.hero.heading"]);
    session.role = "CUSTOMER";
    expect((await getSiteForRequest({ revision: draft.draftId })).preview).toBe(false);
    session.role = "OWNER";
    const preview = await getSiteForRequest({ revision: draft.draftId });
    expect(preview.preview).toBe(true);
    expect(preview.text["home.hero.heading"]).toBe("Draft heading for {businessName}");
    expect(preview.values["header.cta.live"]).toMatchObject({ label: "Call us", target: { type: "phone" } });
    expect(livePromotion(preview.values["site.banner.promotion"] as never, preview.now)?.title).toBe("Fall sale");
    // a draft picture cannot be fetched by a visitor, but the owner's preview can
    expect(await findServableAsset(assetId, "public")).toBeNull();
    expect(await findServableAsset(assetId, "preview")).not.toBeNull();
    // the owner can look at a future moment; the schedule is judged against it
    const later = await getSiteForRequest({ revision: draft.draftId, previewAt: new Date(Date.now() + 2 * 3_600_000).toISOString() });
    expect(livePromotion(later.values["site.banner.promotion"] as never, later.now)).toBeNull();
    expect(livePromotion(later.values["home.feature.promotion"] as never, later.now)?.title).toBe("Later");

    await publishDraft(ids.owner, draft.draftId, draft.version);
    session.role = null;
    const visitor = await getSiteForRequest(undefined);
    expect(visitor.text["home.hero.heading"]).toBe("Draft heading for {businessName}");
    expect(visitor.values["header.cta.live"]).toMatchObject({ label: "Call us" });
    expect(livePromotion(visitor.values["site.banner.promotion"] as never, visitor.now)?.title).toBe("Fall sale");
    expect(livePromotion(visitor.values["home.feature.promotion"] as never, visitor.now)).toBeNull(); // not started: nothing else disappears
    expect(visitor.text["footer.tagline"]).toBe(siteDefaults()["footer.tagline"]);
    expect((await findServableAsset(assetId, "public"))?.state).toBe("PUBLIC");
    expect((await getPublishedValues())["home.hero.image"]).toMatchObject({ kind: "image", assetId });
    expect((await getPublishedContent())["launch.question"]).toBe("Questions? [Contact us](/contact).");
  });

  it("publishing refuses a draft whose stored value is no longer valid", async () => {
    const draft = await prisma.siteContentRevision.create({
      data: {
        status: "DRAFT", version: 9000 + Math.floor(Math.random() * 900), createdByUserId: ids.owner, contentSchemaVersion: 2,
        fields: { "home.hero.eyebrow": { kind: "text", text: "Now in {planet}" } },
      },
    });
    await expect(publishDraft(ids.owner, draft.id, draft.version)).rejects.toThrow(/not available here/);
    await prisma.siteContentRevision.delete({ where: { id: draft.id } });
  });
});
