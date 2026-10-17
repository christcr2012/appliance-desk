import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { collectAssetIds, decodeOrThrow } from "./codec";
import { processUploadedImage } from "./image-processing";
import { getWebsiteAssetStore, websiteAssetKey, websiteStorageConfigured, type WebsiteAssetStore } from "./asset-store";
import { siteFieldSpec } from "./fields";
import { SiteContentError, type SiteValue } from "./types";

// V-C2: website pictures. Owner/admin upload; a picture is DRAFT (preview only) until a publish or restore
// that references it makes it PUBLIC in the same transaction as the pointer move; RETIRED is never served.

const TEAM = ["OWNER", "ADMIN"] as const;
export { assetIdFromPublicPath, draftAssetPath, publicAssetPath } from "./asset-paths";
import { assetIdFromPublicPath } from "./asset-paths";

export type UploadedAsset = { id: string; width: number; height: number; byteSize: number; reused: boolean };

export async function uploadWebsiteAsset(
  userId: string,
  bytes: Uint8Array,
  store: WebsiteAssetStore = getWebsiteAssetStore(),
): Promise<UploadedAsset> {
  await prisma.$transaction(async (tx) => { await assertActiveTeamActor(tx, userId, TEAM); });
  const image = await processUploadedImage(bytes);
  const same = await prisma.websiteAsset.findFirst({
    where: { sha256: image.sha256, state: { not: "RETIRED" } },
    orderBy: { createdAt: "asc" },
  });
  if (same) return { id: same.id, width: same.width, height: same.height, byteSize: same.byteSize, reused: true };

  const id = randomUUID().replace(/-/g, "");
  const storageKey = websiteAssetKey(id);
  await store.put(storageKey, image.bytes, image.mimeType);
  try {
    await prisma.$transaction(async (tx) => {
      await assertActiveTeamActor(tx, userId, TEAM);
      await tx.websiteAsset.create({
        data: { id, storageKey, sha256: image.sha256, mimeType: image.mimeType, width: image.width, height: image.height, byteSize: image.byteSize, createdByUserId: userId },
      });
      await tx.auditLog.create({
        data: { userId, action: "website_asset.uploaded", entityType: "WebsiteAsset", entityId: id, newValue: { width: image.width, height: image.height, byteSize: image.byteSize } },
      });
    });
  } catch (error) {
    await store.remove(storageKey).catch(() => undefined);
    throw error;
  }
  return { id, width: image.width, height: image.height, byteSize: image.byteSize, reused: false };
}

/** Whether a picture may be shown to the public (PUBLIC) or only to a signed-in owner/admin previewing a draft. */
export async function findServableAsset(assetId: string, audience: "public" | "preview") {
  const asset = await prisma.websiteAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.state === "RETIRED") return null;
  if (audience === "public" && asset.state !== "PUBLIC") return null;
  return asset;
}

/**
 * Called inside the publish/restore transaction (pointer already locked). Every picture the revision uses must
 * exist, have its file stored and not be retired; draft pictures become public now. Throws a plain-words block
 * that names the field otherwise, before anything is changed.
 */
export async function promoteReferencedAssets(tx: Prisma.TransactionClient, values: Record<string, SiteValue>): Promise<string[]> {
  const ids = collectAssetIds(values);
  if (ids.length === 0) return [];
  const rows = await tx.websiteAsset.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const checkStore = websiteStorageConfigured();
  for (const [key, value] of Object.entries(values)) {
    const where = siteFieldSpec(key)?.label ?? key;
    for (const id of collectAssetIds({ [key]: value })) {
      const row = byId.get(id);
      if (!row) throw new SiteContentError(`The picture for "${where}" is missing. Choose a picture again, then publish.`, key);
      if (row.state === "RETIRED") throw new SiteContentError(`The picture for "${where}" was removed. Choose a different picture, then publish.`, key);
      if (checkStore) {
        const file = await getWebsiteAssetStore().read(row.storageKey);
        if (!file) throw new SiteContentError(`The picture file for "${where}" could not be found. Upload it again, then publish.`, key);
        await file.stream.cancel().catch(() => undefined);
      }
    }
  }
  const toPromote = ids.filter((id) => byId.get(id)!.state === "DRAFT");
  if (toPromote.length) {
    await tx.websiteAsset.updateMany({ where: { id: { in: toPromote }, state: "DRAFT" }, data: { state: "PUBLIC", publishedAt: new Date() } });
  }
  return toPromote;
}

async function revisionAssetIds(statusWhere: Prisma.SiteContentRevisionWhereInput, tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<Set<string>> {
  const revisions = await tx.siteContentRevision.findMany({ where: statusWhere, select: { fields: true, contentSchemaVersion: true } });
  const ids = new Set<string>();
  for (const revision of revisions) for (const id of collectAssetIds(decodeOrThrow(revision.contentSchemaVersion, revision.fields).values)) ids.add(id);
  return ids;
}

/** Pictures used by the live site or by the open draft (a retire must not break either). */
export async function assetsInUse(tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<Set<string>> {
  const pointer = await tx.siteContentPointer.findUnique({ where: { id: "published" } });
  const live = pointer?.publishedRevisionId ? await revisionAssetIds({ id: pointer.publishedRevisionId }, tx) : new Set<string>();
  const draft = await revisionAssetIds({ status: "DRAFT" }, tx);
  const used = new Set([...live, ...draft]);
  // Catalog pictures (appliance types) point at uploaded pictures directly, outside any website revision.
  const catalog = await tx.applianceType.findMany({ where: { photoUrl: { startsWith: "/api/site-media/" } }, select: { photoUrl: true } });
  for (const row of catalog) {
    const id = row.photoUrl ? assetIdFromPublicPath(row.photoUrl) : null;
    if (id) used.add(id);
  }
  return used;
}

export async function retireWebsiteAsset(userId: string, assetId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, TEAM);
    await tx.$executeRaw`INSERT INTO "SiteContentPointer" ("id", "updatedAt") VALUES ('published', now()) ON CONFLICT ("id") DO NOTHING`;
    await tx.$queryRaw`SELECT "id" FROM "SiteContentPointer" WHERE "id" = 'published' FOR UPDATE`;
    const asset = await tx.websiteAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.state === "RETIRED") throw new SiteContentError("That picture was not found.");
    if ((await assetsInUse(tx)).has(assetId)) {
      throw new SiteContentError("That picture is used on the website (live or in your draft). Choose a different picture there first.");
    }
    await tx.websiteAsset.update({ where: { id: assetId }, data: { state: "RETIRED", retiredAt: new Date() } });
    await tx.auditLog.create({ data: { userId, action: "website_asset.retired", entityType: "WebsiteAsset", entityId: assetId } });
  });
}

/**
 * Bounded cleanup: removes only old DRAFT pictures nothing refers to (never PUBLIC or in-use ones).
 * Safe to run repeatedly; runbook: docs/runbooks/WEBSITE-ASSET-CLEANUP.md.
 */
export async function cleanupStaleDraftAssets(options: { olderThanDays?: number; limit?: number; now?: Date; store?: WebsiteAssetStore } = {}): Promise<{ removed: number }> {
  const store = options.store ?? getWebsiteAssetStore();
  const cutoff = new Date((options.now ?? new Date()).getTime() - (options.olderThanDays ?? 14) * 86_400_000);
  const candidates = await prisma.websiteAsset.findMany({
    where: { state: "DRAFT", createdAt: { lt: cutoff } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: Math.min(Math.max(options.limit ?? 50, 1), 200),
  });
  let removed = 0;
  for (const asset of candidates) {
    const used = await assetsInUse();
    if (used.has(asset.id)) continue;
    await store.remove(asset.storageKey);
    const gone = await prisma.websiteAsset.deleteMany({ where: { id: asset.id, state: "DRAFT" } });
    removed += gone.count;
  }
  return { removed };
}
