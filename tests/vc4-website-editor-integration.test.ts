// Real-Postgres proof for V-C4: the editor's publish, restore and discard rules hold under staleness, repeats and races,
// only active owners and admins can use them, and nothing but a publish ever moves what visitors see.
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  STALE_DRAFT_MESSAGE, STALE_LIVE_MESSAGE, discardDraft, getDraftReview, getPublishedContent, getWebsiteOverview, publishDraft, restoreRevisionToDraft, saveDraft,
} from "@/domains/site-content";
import { siteDefaults } from "@/domains/site-content/fields";
import { uploadWebsiteAsset } from "@/domains/site-content/assets";
import { MemoryAssetStore, setWebsiteAssetStoreForTests } from "@/domains/site-content/asset-store";

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const run = process.env.CI === "true";
const d = describe.skipIf(!run);

const text = (t: string) => ({ kind: "text", text: t });

d("website editor rules, end to end", () => {
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: "", admin: "", staff: "", gone: "" };
  const store = new MemoryAssetStore();

  async function clean() {
    await prisma.siteContentPointer.updateMany({ where: { id: "published" }, data: { publishedRevisionId: null } });
    await prisma.siteContentRevision.deleteMany({});
  }
  async function mk(role: "OWNER" | "ADMIN" | "STAFF", label: string, active = true) {
    const u = await prisma.user.create({ data: { name: `${label} ${tag}`, email: `${label}-${tag}@example.test`, emailVerified: true, role, ...(active ? {} : { archivedAt: new Date() }) } });
    return u.id;
  }

  beforeAll(async () => {
    expect(["localhost", "127.0.0.1"]).toContain(new URL(process.env.DATABASE_URL!).hostname);
    ids.owner = await mk("OWNER", "owner");
    ids.admin = await mk("ADMIN", "admin");
    ids.staff = await mk("STAFF", "staff");
    ids.gone = await mk("OWNER", "gone", false);
    await clean();
    await prisma.siteContentPointer.upsert({ where: { id: "published" }, create: { id: "published", publishedRevisionId: null }, update: {} });
    setWebsiteAssetStoreForTests(store);
  });
  afterAll(async () => {
    setWebsiteAssetStoreForTests(null);
    await clean();
    await prisma.websiteAsset.deleteMany({ where: { createdByUserId: { in: Object.values(ids) } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  });

  const livePointer = async () => (await prisma.siteContentPointer.findUnique({ where: { id: "published" } }))?.publishedRevisionId ?? null;

  it("starts with nothing published and no draft; a saved draft counts its real changes and is not live", async () => {
    const before = await getWebsiteOverview();
    expect(before).toMatchObject({ live: null, draft: null, versionsPublished: 0 });
    const saved = await saveDraft(ids.owner, { values: { "how.intro": text("Draft words one"), "home.hero.heading": text(siteDefaults()["home.hero.heading"]) } });
    const overview = await getWebsiteOverview();
    // The second item equals the starting words, so only one thing actually differs from the live website.
    expect(overview.draft).toMatchObject({ id: saved.draftId, version: saved.version, changeCount: 1 });
    expect((await getPublishedContent())["how.intro"]).not.toBe("Draft words one");
    expect(await livePointer()).toBeNull();
  });

  it("reviews exactly what would change and publishes only when the live version is still the one reviewed", async () => {
    const draft = (await getWebsiteOverview()).draft!;
    const review = await getDraftReview({ phone: "970-555-0100" });
    expect(review.changes.map((c) => c.key)).toEqual(["how.intro"]);
    expect(review.problems).toEqual([]);
    expect(review.liveRevisionId).toBeNull();

    // Someone else publishes first: our reviewed "nothing is live" is now out of date.
    const rival = await saveDraft(ids.admin, { draftId: draft.id, expectedVersion: draft.version, values: { "how.intro": text("Rival words") } });
    await publishDraft(ids.admin, rival.draftId, rival.version, null);
    const staleDraft = await saveDraft(ids.owner, { values: { "how.intro": text("Owner words") } });
    await expect(publishDraft(ids.owner, staleDraft.draftId, staleDraft.version, null)).rejects.toThrow(STALE_LIVE_MESSAGE);
    expect((await getPublishedContent())["how.intro"]).toBe("Rival words");

    // Reviewed against the right live version it goes through, and a repeat click changes nothing more.
    const liveNow = await livePointer();
    const first = await publishDraft(ids.owner, staleDraft.draftId, staleDraft.version, liveNow);
    expect(first.alreadyLive).toBeUndefined();
    const again = await publishDraft(ids.owner, staleDraft.draftId, staleDraft.version, liveNow);
    expect(again).toMatchObject({ revisionId: first.revisionId, version: first.version, alreadyLive: true });
    expect((await getPublishedContent())["how.intro"]).toBe("Owner words");
    expect(await prisma.auditLog.count({ where: { action: "site_content.published", entityId: first.revisionId } })).toBe(1);
  });

  it("two people publishing the same draft at the same moment leave exactly one live version", async () => {
    const live = await livePointer();
    const draft = await saveDraft(ids.owner, { values: { "how.intro": text("Race words") } });
    const results = await Promise.allSettled([
      publishDraft(ids.owner, draft.draftId, draft.version, live),
      publishDraft(ids.admin, draft.draftId, draft.version, live),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(results.filter((r) => r.status === "fulfilled" && r.value.alreadyLive).length).toBe(1);
    expect(await livePointer()).toBe(draft.draftId);
    expect(await prisma.siteContentRevision.count({ where: { status: "PUBLISHED" } })).toBe(1);
  });

  it("restoring an old version puts it in the draft, leaves the live website alone, and replaces an open draft only knowingly", async () => {
    const old = await prisma.siteContentRevision.findFirst({ where: { status: "ARCHIVED", publishedAt: { not: null } }, orderBy: { version: "asc" } });
    expect(old).not.toBeNull();
    const liveBefore = await livePointer();
    const restored = await restoreRevisionToDraft(ids.owner, old!.id);
    expect(await livePointer()).toBe(liveBefore);
    const row = await prisma.siteContentRevision.findUnique({ where: { id: restored.draftId } });
    expect(row).toMatchObject({ status: "DRAFT", restoredFromId: old!.id });
    expect(row!.note).toContain(`Restored from version ${old!.version}`);
    expect(await prisma.auditLog.count({ where: { action: "site_content.restored_to_draft", entityId: restored.draftId } })).toBe(1);

    // A second restore with no knowledge of the open draft is refused instead of overwriting it.
    await expect(restoreRevisionToDraft(ids.owner, old!.id)).rejects.toThrow(STALE_DRAFT_MESSAGE);
    const replaced = await restoreRevisionToDraft(ids.owner, old!.id, { draftId: restored.draftId, draftVersion: restored.version });
    expect(replaced.replacedDraft).toBe(true);
    // Only published versions can be restored.
    await expect(restoreRevisionToDraft(ids.owner, replaced.draftId, { draftId: replaced.draftId, draftVersion: replaced.version })).rejects.toThrow("never published");
  });

  it("discarding needs the version the screen showed, removes only the draft, and is audited", async () => {
    const open = (await getWebsiteOverview()).draft!;
    const liveBefore = await livePointer();
    await expect(discardDraft(ids.owner, open.id, open.version + 5)).rejects.toThrow(STALE_DRAFT_MESSAGE);
    await discardDraft(ids.owner, open.id, open.version);
    expect((await getWebsiteOverview()).draft).toBeNull();
    expect(await livePointer()).toBe(liveBefore);
    expect(await prisma.auditLog.count({ where: { action: "site_content.draft_discarded", entityId: open.id } })).toBe(1);
    await expect(discardDraft(ids.owner, open.id, open.version)).rejects.toThrow(STALE_DRAFT_MESSAGE);
  });

  it("blocks review, publish and restore for a picture that was removed, naming the item", async () => {
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 20, b: 40 } } }).png().toBuffer();
    const asset = await uploadWebsiteAsset(ids.owner, png, store);
    const image = { kind: "image", assetId: asset.id, alt: "A red test picture", decorative: false, focalX: 50, focalY: 50 };
    const liveNow = await livePointer();
    const withPicture = await saveDraft(ids.owner, { values: { "home.hero.image": image } });
    const goodReview = await getDraftReview({});
    expect(goodReview.problems).toEqual([]);
    const published = await publishDraft(ids.owner, withPicture.draftId, withPicture.version, liveNow);
    expect((await prisma.websiteAsset.findUnique({ where: { id: asset.id } }))!.state).toBe("PUBLIC");

    // The picture is later retired (the app refuses this while it is in use, so this simulates a manual clean-up).
    await prisma.websiteAsset.update({ where: { id: asset.id }, data: { state: "RETIRED", retiredAt: new Date() } });
    const next = await saveDraft(ids.owner, { values: { "home.hero.image": image, "how.intro": text("After retire") } });
    const review = await getDraftReview({});
    expect(review.problems.join(" ")).toMatch(/Hero|picture/i);
    await expect(publishDraft(ids.owner, next.draftId, next.version, published.revisionId)).rejects.toThrow(/removed/);
    expect(await livePointer()).toBe(published.revisionId);
    await expect(restoreRevisionToDraft(ids.owner, published.revisionId, { draftId: next.draftId, draftVersion: next.version })).rejects.toThrow(/removed/);
    // The refused restore changed nothing: the open draft is still there.
    expect((await getWebsiteOverview()).draft?.id).toBe(next.draftId);
  });

  it("refuses staff, deactivated owners and nobody-at-all at the domain, whatever the screen did", async () => {
    const open = (await getWebsiteOverview()).draft!;
    const live = await livePointer();
    for (const who of [ids.staff, ids.gone, "no-such-user"]) {
      await expect(publishDraft(who, open.id, open.version, live)).rejects.toThrow();
      await expect(discardDraft(who, open.id, open.version)).rejects.toThrow();
      await expect(restoreRevisionToDraft(who, live!)).rejects.toThrow();
      await expect(saveDraft(who, { values: {} })).rejects.toThrow();
    }
    expect(await livePointer()).toBe(live);
    expect((await getWebsiteOverview()).draft?.id).toBe(open.id);
  });
});
