// Real-Postgres proof for V-C1 (versioned content) and V-C2 (website pictures). Runs only in CI / the sandbox.
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getEditorValueState, getEditorState, getPublishedContent, getPublishedValues, publishDraft, restoreRevision, saveDraft,
} from "@/domains/site-content";
import { siteDefaults } from "@/domains/site-content/fields";
import {
  cleanupStaleDraftAssets, findServableAsset, retireWebsiteAsset, uploadWebsiteAsset,
} from "@/domains/site-content/assets";
import { MemoryAssetStore, setWebsiteAssetStoreForTests } from "@/domains/site-content/asset-store";
import { setAppliancePhotoUrl } from "@/domains/settings";

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const run = process.env.CI === "true";
const d = describe.skipIf(!run);

d("versioned website content and pictures", () => {
  const ids = { owner: "", staff: "" };
  const tag = randomUUID().slice(0, 8);
  const store = new MemoryAssetStore();
  const typeIds: string[] = [];

  async function user(role: "OWNER" | "STAFF", archived = false) {
    const u = await prisma.user.create({
      data: { name: `${role} ${tag}`, email: `${role.toLowerCase()}-${tag}-${randomUUID().slice(0, 4)}@example.test`, emailVerified: true, role, archivedAt: archived ? new Date() : null },
    });
    return u.id;
  }
  async function clean() {
    await prisma.siteContentPointer.updateMany({ where: { id: "published" }, data: { publishedRevisionId: null } });
    await prisma.siteContentRevision.deleteMany({});
  }
  let colour = 0;
  async function picture(): Promise<string> {
    colour += 7;
    const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: colour, g: 90, b: 40 } } }).png().toBuffer();
    return (await uploadWebsiteAsset(ids.owner, bytes, store)).id;
  }
  const hero = (assetId: string) => ({ kind: "image", assetId, alt: "A clean washer", decorative: false, focalX: 30, focalY: 70 });

  beforeAll(async () => {
    expect(["localhost", "127.0.0.1"]).toContain(new URL(process.env.DATABASE_URL!).hostname);
    ids.owner = await user("OWNER");
    ids.staff = await user("STAFF");
    await clean();
    setWebsiteAssetStoreForTests(store);
  });
  afterAll(async () => {
    setWebsiteAssetStoreForTests(null);
    await clean();
    await prisma.websiteAsset.deleteMany({ where: { createdByUserId: { in: Object.values(ids) } } });
    await prisma.applianceType.deleteMany({ where: { id: { in: typeIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  });

  it("V-C1 upgrade: an existing populated text revision reads identically and new saves are version 2", async () => {
    await clean();
    const old = await prisma.siteContentRevision.create({
      data: {
        status: "PUBLISHED", version: 1, publishedAt: new Date(), createdByUserId: ids.owner, publishedByUserId: ids.owner,
        fields: { "home.hero.heading": "Old heading kept", "home.hero.subheading": "", "retired.key": "gone" },
      },
    });
    expect(old.contentSchemaVersion).toBe(1); // the column default is what every row existing before this release has
    expect(old.templateVersion).toBeNull();
    await prisma.siteContentPointer.upsert({ where: { id: "published" }, create: { id: "published", publishedRevisionId: old.id }, update: { publishedRevisionId: old.id } });

    const live = await getPublishedContent();
    expect(live["home.hero.heading"]).toBe("Old heading kept");
    expect(live["home.hero.subheading"]).toBe(siteDefaults()["home.hero.subheading"]); // empty = not set
    expect(Object.keys(live)).not.toContain("retired.key");
    expect(Object.keys(live).sort()).toEqual(Object.keys(siteDefaults()).sort());

    const draft = await saveDraft(ids.owner, { fields: { "home.hero.heading": "New heading" } });
    const row = await prisma.siteContentRevision.findUniqueOrThrow({ where: { id: draft.draftId } });
    expect(row.contentSchemaVersion).toBe(2);
    expect(row.templateVersion).toBe("signature-2");
    const editor = await getEditorState();
    expect(editor.published?.stored["home.hero.heading"]).toBe("Old heading kept");
    expect(editor.draft?.stored["home.hero.heading"]).toBe("New heading");
    const old2 = await prisma.siteContentRevision.findUniqueOrThrow({ where: { id: old.id } });
    expect(old2.fields).toEqual(old.fields); // history is never rewritten
  });

  it("V-C2: only an active owner/admin can upload; same picture is reused; nothing is public yet", async () => {
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#336699" } }).png().toBuffer();
    await expect(uploadWebsiteAsset(ids.staff, png, store)).rejects.toThrow(/no longer has access/);
    const gone = await user("OWNER", true);
    await expect(uploadWebsiteAsset(gone, png, store)).rejects.toThrow(/no longer has access/);
    await prisma.user.delete({ where: { id: gone } });
    const first = await uploadWebsiteAsset(ids.owner, png, store);
    const again = await uploadWebsiteAsset(ids.owner, png, store);
    expect(again.id).toBe(first.id);
    expect(again.reused).toBe(true);
    expect(store.files.has(`website-assets/${first.id}.webp`)).toBe(true);
    const row = await prisma.websiteAsset.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.state).toBe("DRAFT");
    expect(row.mimeType).toBe("image/webp");
    expect(await findServableAsset(first.id, "public")).toBeNull();
    expect(await findServableAsset(first.id, "preview")).not.toBeNull();
  });

  it("V-C2: publishing makes exactly the referenced pictures public, in the same step as the pointer", async () => {
    await clean();
    const used = await picture();
    const spare = await picture();
    const draft = await saveDraft(ids.owner, { values: { "home.hero.image": hero(used) } });
    await publishDraft(ids.owner, draft.draftId, draft.version);
    expect((await prisma.websiteAsset.findUniqueOrThrow({ where: { id: used } })).state).toBe("PUBLIC");
    expect((await prisma.websiteAsset.findUniqueOrThrow({ where: { id: used } })).publishedAt).not.toBeNull();
    expect((await prisma.websiteAsset.findUniqueOrThrow({ where: { id: spare } })).state).toBe("DRAFT");
    expect(await findServableAsset(used, "public")).not.toBeNull();
    expect(await findServableAsset(spare, "public")).toBeNull();
    const values = await getPublishedValues();
    expect(values["home.hero.image"]).toMatchObject({ kind: "image", assetId: used, focalX: 30 });
  });

  it("V-C2: a text-only save keeps the picture already in the draft or live site", async () => {
    const live = await getEditorValueState();
    expect(live.published?.values["home.hero.image"]).toBeDefined();
    const draft = await saveDraft(ids.owner, { fields: { "home.hero.heading": "Words only change" } });
    const state = await getEditorValueState();
    expect(state.draft?.id).toBe(draft.draftId);
    expect(state.draft?.values["home.hero.image"]).toMatchObject({ kind: "image" });
    expect(state.draft?.values["home.hero.heading"]).toMatchObject({ kind: "text", text: "Words only change" });
    await prisma.siteContentRevision.delete({ where: { id: draft.draftId } });
  });

  it("V-C2: publish is blocked, and changes nothing, for a missing or retired picture", async () => {
    const before = (await prisma.siteContentPointer.findUniqueOrThrow({ where: { id: "published" } })).publishedRevisionId;
    const missing = await saveDraft(ids.owner, { values: { "home.hero.image": hero("does-not-exist-1") } });
    await expect(publishDraft(ids.owner, missing.draftId, missing.version)).rejects.toThrow(/The picture for "Main photo" is missing/);
    expect((await prisma.siteContentPointer.findUniqueOrThrow({ where: { id: "published" } })).publishedRevisionId).toBe(before);
    expect((await prisma.siteContentRevision.findUniqueOrThrow({ where: { id: missing.draftId } })).status).toBe("DRAFT");

    const doomed = await picture();
    const retiredDraft = await saveDraft(ids.owner, { draftId: missing.draftId, expectedVersion: missing.version, values: { "home.hero.image": hero(doomed) } });
    await prisma.websiteAsset.update({ where: { id: doomed }, data: { state: "RETIRED", retiredAt: new Date() } });
    await expect(publishDraft(ids.owner, retiredDraft.draftId, retiredDraft.version)).rejects.toThrow(/The picture for "Main photo" was removed/);
    expect((await prisma.siteContentPointer.findUniqueOrThrow({ where: { id: "published" } })).publishedRevisionId).toBe(before);
    await prisma.siteContentRevision.delete({ where: { id: retiredDraft.draftId } });
  });

  it("V-C2: a picture whose file is gone from storage, or a customer/job photo id, cannot be published", async () => {
    const gone = await picture();
    const draft = await saveDraft(ids.owner, { values: { "home.hero.image": hero(gone) } });
    const row = await prisma.websiteAsset.findUniqueOrThrow({ where: { id: gone } });
    const kept = store.files.get(row.storageKey)!;
    store.files.delete(row.storageKey);
    await expect(publishDraft(ids.owner, draft.draftId, draft.version)).rejects.toThrow(/picture file for "Main photo" could not be found/);
    expect((await prisma.websiteAsset.findUniqueOrThrow({ where: { id: gone } })).state).toBe("DRAFT");
    store.files.set(row.storageKey, kept);

    // A job/customer photo id (or a storage path) is not a website picture: only the website picture table counts.
    const photo = await prisma.photo.findFirst({ select: { id: true } });
    const photoId = photo?.id ?? "cjphotoidnotawebsitepicture";
    const other = await saveDraft(ids.owner, { draftId: draft.draftId, expectedVersion: draft.version, values: { "home.hero.image": hero(photoId) } });
    await expect(publishDraft(ids.owner, other.draftId, other.version)).rejects.toThrow(/is missing/);
    await expect(saveDraft(ids.owner, { draftId: other.draftId, expectedVersion: other.version, values: { "home.hero.image": hero("jobs/abc/photo.jpg") } })).rejects.toThrow();
    await prisma.siteContentRevision.delete({ where: { id: other.draftId } });
  });

  it("V-C2: refused uploads store nothing (SVG, HTML, remote address, oversize)", async () => {
    const filesBefore = store.files.size;
    const rowsBefore = await prisma.websiteAsset.count();
    for (const bad of [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), Buffer.from("<html></html>"), Buffer.from("https://example.com/a.jpg"), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(11 * 1024 * 1024)])]) {
      await expect(uploadWebsiteAsset(ids.owner, bad, store)).rejects.toThrow();
    }
    expect(store.files.size).toBe(filesBefore);
    expect(await prisma.websiteAsset.count()).toBe(rowsBefore);
  });

  it("V-C2: retire is refused while live or in the draft, then allowed; restoring an old version that needs it is blocked", async () => {
    const liveRev = (await prisma.siteContentPointer.findUniqueOrThrow({ where: { id: "published" } })).publishedRevisionId!;
    const liveAsset = ((await prisma.siteContentRevision.findUniqueOrThrow({ where: { id: liveRev } })).fields as Record<string, { assetId: string }>)["home.hero.image"].assetId;
    await expect(retireWebsiteAsset(ids.owner, liveAsset)).rejects.toThrow(/used on the website/);
    await expect(retireWebsiteAsset(ids.staff, liveAsset)).rejects.toThrow(/no longer has access/);

    // Replace the picture, then the old one is free to retire.
    const next = await picture();
    const draft = await saveDraft(ids.owner, { values: { "home.hero.image": hero(next) } });
    await publishDraft(ids.owner, draft.draftId, draft.version);
    await retireWebsiteAsset(ids.owner, liveAsset);
    expect((await prisma.websiteAsset.findUniqueOrThrow({ where: { id: liveAsset } })).state).toBe("RETIRED");
    expect(await findServableAsset(liveAsset, "public")).toBeNull();
    await expect(restoreRevision(ids.owner, liveRev)).rejects.toThrow(/was removed/);
    expect((await prisma.auditLog.count({ where: { userId: ids.owner, action: "website_asset.retired", entityId: liveAsset } }))).toBe(1);
  });

  it("V-C2: cleanup removes only old, unused draft pictures", async () => {
    const stale = await picture();
    const staleInUse = await picture();
    const fresh = await picture();
    const draft = await saveDraft(ids.owner, { values: { "home.hero.image": hero(staleInUse) } });
    const old = new Date(Date.now() - 30 * 86_400_000);
    await prisma.websiteAsset.updateMany({ where: { id: { in: [stale, staleInUse] } }, data: { createdAt: old } });
    const publicOld = (await prisma.siteContentPointer.findUniqueOrThrow({ where: { id: "published" } })).publishedRevisionId!;
    const livePic = ((await prisma.siteContentRevision.findUniqueOrThrow({ where: { id: publicOld } })).fields as Record<string, { assetId: string }>)["home.hero.image"].assetId;
    await prisma.websiteAsset.update({ where: { id: livePic }, data: { createdAt: old } });

    const result = await cleanupStaleDraftAssets({ olderThanDays: 14, store });
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(await prisma.websiteAsset.findUnique({ where: { id: stale } })).toBeNull();
    expect(store.files.has(`website-assets/${stale}.webp`)).toBe(false);
    for (const keep of [staleInUse, fresh, livePic]) expect(await prisma.websiteAsset.findUnique({ where: { id: keep } })).not.toBeNull();
    await prisma.siteContentRevision.delete({ where: { id: draft.draftId } });
  });

  it("catalog photo setter: owner/admin only, safe addresses only, uploaded picture goes public, audited", async () => {
    const type = await prisma.applianceType.create({ data: { name: `VC2 type ${tag}`, slug: `vc2-type-${tag}` } });
    typeIds.push(type.id);
    await expect(setAppliancePhotoUrl(ids.staff, type.id, "https://example.com/a.jpg")).rejects.toThrow(/no longer has access/);
    for (const bad of ["http://example.com/a.jpg", "javascript:alert(1)", "/etc/passwd", "/api/site-media/../x"]) {
      await expect(setAppliancePhotoUrl(ids.owner, type.id, bad), bad).rejects.toThrow(/https:\/\//);
    }
    await expect(setAppliancePhotoUrl(ids.owner, type.id, "/api/site-media/nonexistent1")).rejects.toThrow(/not available/);
    await setAppliancePhotoUrl(ids.owner, type.id, "https://example.com/a.jpg");
    const asset = await picture();
    await setAppliancePhotoUrl(ids.owner, type.id, `/api/site-media/${asset}`);
    expect((await prisma.websiteAsset.findUniqueOrThrow({ where: { id: asset } })).state).toBe("PUBLIC");
    await expect(retireWebsiteAsset(ids.owner, asset)).rejects.toThrow(/used on the website/);
    expect(await prisma.auditLog.count({ where: { userId: ids.owner, action: "appliance.photo", entityId: type.id } })).toBe(2);
    await setAppliancePhotoUrl(ids.owner, type.id, null);
    expect((await prisma.applianceType.findUniqueOrThrow({ where: { id: type.id } })).photoUrl).toBeNull();
    await retireWebsiteAsset(ids.owner, asset);
  });
});
