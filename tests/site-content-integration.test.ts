// Real-Postgres proof for the website text revisions. Runs only in CI / the sandbox against a throwaway database.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  STALE_DRAFT_MESSAGE,
  getEditorState,
  getPublishedContent,
  getRevisionContent,
  publishDraft,
  restoreRevision,
  saveDraft,
} from "@/domains/site-content";
import { siteDefaults } from "@/domains/site-content/fields";

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const run = process.env.CI === "true";
const d = describe.skipIf(!run);

d("website text revisions", () => {
  const ids = { owner: "", admin: "", staff: "" };
  const tag = randomUUID().slice(0, 8);
  let savedPointer: string | null = null;

  async function user(role: "OWNER" | "ADMIN" | "STAFF", archived = false) {
    const u = await prisma.user.create({
      data: {
        name: `${role} ${tag}`,
        email: `${role.toLowerCase()}-${tag}-${randomUUID().slice(0, 4)}@example.test`,
        emailVerified: true,
        role,
        archivedAt: archived ? new Date() : null,
      },
    });
    return u.id;
  }

  async function clean() {
    await prisma.siteContentPointer.updateMany({ where: { id: "published" }, data: { publishedRevisionId: null } });
    await prisma.siteContentRevision.deleteMany({});
  }

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
    const p = await prisma.siteContentPointer.findUnique({ where: { id: "published" } });
    savedPointer = p?.publishedRevisionId ?? null;
    ids.owner = await user("OWNER");
    ids.admin = await user("ADMIN");
    ids.staff = await user("STAFF");
    await clean();
  });

  afterAll(async () => {
    await clean();
    expect(savedPointer).toBeNull(); // the throwaway database starts with nothing published
    await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  });

  it("shows today's text when nothing is published, and never shows a draft", async () => {
    await clean();
    expect(await getPublishedContent()).toEqual(siteDefaults());
    const draft = await saveDraft(ids.owner, { fields: { "home.hero.heading": "Draft only heading" } });
    expect((await getPublishedContent())["home.hero.heading"]).toBe(siteDefaults()["home.hero.heading"]);
    expect((await getRevisionContent(draft.draftId))["home.hero.heading"]).toBe("Draft only heading");
  });

  it("refuses a team member who is not an owner or admin, and an archived owner", async () => {
    await expect(saveDraft(ids.staff, { fields: {} })).rejects.toThrow(/no longer has access/);
    const gone = await user("OWNER", true);
    await expect(saveDraft(gone, { fields: {} })).rejects.toThrow(/no longer has access/);
    await prisma.user.delete({ where: { id: gone } });
  });

  it("rejects an unknown key before anything is stored", async () => {
    await clean();
    await expect(saveDraft(ids.owner, { fields: { "home.nope": "x" } })).rejects.toThrow(/not something you can change/);
    expect(await prisma.siteContentRevision.count()).toBe(0);
  });

  it("strips < and > when saving", async () => {
    await clean();
    const draft = await saveDraft(ids.owner, { fields: { "home.hero.heading": "A <b>bold</b> claim" } });
    const row = await prisma.siteContentRevision.findUniqueOrThrow({ where: { id: draft.draftId } });
    expect((row.fields as Record<string, string>)["home.hero.heading"]).toBe("A bbold/b claim");
  });

  it("publishes: moves the live pointer, archives the old one, records who and when", async () => {
    await clean();
    const a = await saveDraft(ids.owner, { fields: { "home.hero.heading": "First" } });
    const pa = await publishDraft(ids.owner, a.draftId, a.version);
    const b = await saveDraft(ids.admin, { fields: { "home.hero.heading": "Second" } });
    const pb = await publishDraft(ids.admin, b.draftId, b.version);
    expect((await getPublishedContent())["home.hero.heading"]).toBe("Second");
    const first = await prisma.siteContentRevision.findUniqueOrThrow({ where: { id: pa.revisionId } });
    const second = await prisma.siteContentRevision.findUniqueOrThrow({ where: { id: pb.revisionId } });
    expect(first.status).toBe("ARCHIVED");
    expect(second.status).toBe("PUBLISHED");
    expect(second.publishedByUserId).toBe(ids.admin);
    expect(second.publishedAt).not.toBeNull();
    expect(await prisma.siteContentRevision.count({ where: { status: "PUBLISHED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "site_content.published", entityId: pb.revisionId } })).toBe(1);
  });

  it("refuses a save or publish from a screen that is out of date", async () => {
    await clean();
    const a = await saveDraft(ids.owner, { fields: { "home.hero.heading": "One" } });
    const b = await saveDraft(ids.admin, { draftId: a.draftId, expectedVersion: a.version, fields: { "home.hero.heading": "Two" } });
    // The first person still has the old screen open.
    await expect(
      saveDraft(ids.owner, { draftId: a.draftId, expectedVersion: a.version, fields: { "home.hero.heading": "Three" } }),
    ).rejects.toThrow(STALE_DRAFT_MESSAGE);
    await expect(publishDraft(ids.owner, a.draftId, a.version)).rejects.toThrow(STALE_DRAFT_MESSAGE);
    // A second "new draft" while one is open is also a conflict.
    await expect(saveDraft(ids.owner, { fields: {} })).rejects.toThrow(STALE_DRAFT_MESSAGE);
    expect((await getEditorState()).draft?.id).toBe(b.draftId);
    // Wrong expected version on the right draft.
    await expect(publishDraft(ids.owner, b.draftId, b.version + 5)).rejects.toThrow(STALE_DRAFT_MESSAGE);
  });

  it("restores an old version as a NEW revision with the same text and a link back", async () => {
    await clean();
    const a = await saveDraft(ids.owner, { fields: { "how.intro": "Original intro" } });
    const pa = await publishDraft(ids.owner, a.draftId, a.version);
    const b = await saveDraft(ids.owner, { fields: { "how.intro": "Changed intro" } });
    await publishDraft(ids.owner, b.draftId, b.version);
    const { newRevisionId } = await restoreRevision(ids.owner, pa.revisionId);
    const restored = await prisma.siteContentRevision.findUniqueOrThrow({ where: { id: newRevisionId } });
    expect(restored.restoredFromId).toBe(pa.revisionId);
    expect(restored.status).toBe("PUBLISHED");
    expect(restored.version).toBeGreaterThan(b.version);
    expect((await getPublishedContent())["how.intro"]).toBe("Original intro");
    // The original is untouched.
    const original = await prisma.siteContentRevision.findUniqueOrThrow({ where: { id: pa.revisionId } });
    expect(original.status).toBe("ARCHIVED");
    expect(await prisma.siteContentRevision.count({ where: { status: "PUBLISHED" } })).toBe(1);
  });

  it("will not restore something that was never published", async () => {
    await clean();
    const a = await saveDraft(ids.owner, { fields: { "how.intro": "x" } });
    await expect(restoreRevision(ids.owner, a.draftId)).rejects.toThrow(/never published/);
    await expect(restoreRevision(ids.staff, a.draftId)).rejects.toThrow(/no longer has access/);
  });

  it("ignores stored keys that are not on the list when reading", async () => {
    await clean();
    const rev = await prisma.siteContentRevision.create({
      data: {
        status: "PUBLISHED",
        version: 1,
        fields: { "home.hero.heading": "Legit", "evil.key": "nope", "how.intro": 7 },
        createdByUserId: ids.owner,
        publishedAt: new Date(),
        publishedByUserId: ids.owner,
      },
    });
    await prisma.siteContentPointer.upsert({
      where: { id: "published" },
      create: { id: "published", publishedRevisionId: rev.id },
      update: { publishedRevisionId: rev.id },
    });
    const content = await getPublishedContent();
    expect(content["home.hero.heading"]).toBe("Legit");
    expect(content["evil.key"]).toBeUndefined();
    expect(content["how.intro"]).toBe(siteDefaults()["how.intro"]);
  });

  it("two publishes at the same moment: exactly one is live and the pointer agrees", async () => {
    await clean();
    const a = await saveDraft(ids.owner, { fields: { "home.hero.heading": "Racer" } });
    const results = await Promise.allSettled([
      publishDraft(ids.owner, a.draftId, a.version),
      publishDraft(ids.admin, a.draftId, a.version),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain(STALE_DRAFT_MESSAGE);
    const live = await prisma.siteContentRevision.findMany({ where: { status: "PUBLISHED" } });
    const pointer = await prisma.siteContentPointer.findUniqueOrThrow({ where: { id: "published" } });
    expect(live).toHaveLength(1);
    expect(pointer.publishedRevisionId).toBe(live[0].id);
  });
});
