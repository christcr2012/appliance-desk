import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPrivatePhotoStore } from "@/lib/photo-storage";
import { deletePrivatePhotoWithRecovery } from "@/domains/backup/media-deletion";

/**
 * Clean-up of stored pictures and receipt files nobody needs any more.
 *
 * When a receipt page is removed, or a customer takes a photo off a request before sending it, the record goes away
 * at once but the file itself used to stay in storage forever. Those files are now put on a waiting list. The nightly
 * job deletes a file only after the waiting period AND only if no record anywhere still points at it, so a mistaken
 * removal can be put right (or a backup restored) first, and a file that is in use again is never deleted.
 */
export const CLEANUP_GRACE_DAYS = 30;
/** A photo the customer removed before sending was never attached to anything, so it can go sooner. */
export const UNSENT_PHOTO_GRACE_DAYS = 1;
// The two numbers above are only the starting values. The real waiting periods are the owner's settings
// (BusinessSettings.receiptFileKeepDays and unsentPhotoKeepDays, Settings → Rental policies), read when a file is queued
// so a later change never moves the deadline of a file already waiting.
const MAX_ATTEMPTS = 5;
const PAGE = 50;
const MAX_PASSES = 20;
const DAY_MS = 86_400_000;

type Db = Prisma.TransactionClient;

/** Puts a file on the waiting list (once; asking again changes nothing). Returns true when it was newly queued. */
export async function queueStoredFileCleanup(
  db: Db,
  input: { url: string; reason: string; kind?: "receipt" | "unsent-photo"; graceDays?: number; now?: Date },
): Promise<boolean> {
  const url = input.url.trim();
  if (!url) return false;
  const now = input.now ?? new Date();
  let graceDays = input.graceDays;
  if (graceDays === undefined) {
    const settings = await db.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { receiptFileKeepDays: true, unsentPhotoKeepDays: true },
    });
    graceDays = input.kind === "unsent-photo"
      ? settings?.unsentPhotoKeepDays ?? UNSENT_PHOTO_GRACE_DAYS
      : settings?.receiptFileKeepDays ?? CLEANUP_GRACE_DAYS;
  }
  const deleteAfter = new Date(now.getTime() + graceDays * DAY_MS);
  const rows = await db.$executeRaw`
    INSERT INTO "StoredFileCleanup" ("id", "url", "reason", "queuedAt", "deleteAfter")
    VALUES (${`sfc_${crypto.randomUUID()}`}, ${url}, ${input.reason}, ${now}, ${deleteAfter})
    ON CONFLICT ("url") DO NOTHING`;
  return rows === 1;
}

/**
 * True when any record still holds this address. Looks inside the whole row of every table that can hold a picture
 * address, so a new column added later is covered too.
 */
export async function isStoredFileInUse(url: string, db: Db | typeof prisma = prisma): Promise<boolean> {
  const checks = await Promise.all([
    db.$queryRaw<unknown[]>`SELECT 1 FROM "Photo" t WHERE position(${url} in to_jsonb(t)::text) > 0 LIMIT 1`,
    db.$queryRaw<unknown[]>`SELECT 1 FROM "ApplianceType" t WHERE position(${url} in to_jsonb(t)::text) > 0 LIMIT 1`,
    db.$queryRaw<unknown[]>`SELECT 1 FROM "RentalPackage" t WHERE position(${url} in to_jsonb(t)::text) > 0 LIMIT 1`,
    db.$queryRaw<unknown[]>`SELECT 1 FROM "BusinessSettings" t WHERE position(${url} in to_jsonb(t)::text) > 0 LIMIT 1`,
    db.$queryRaw<unknown[]>`SELECT 1 FROM "SiteContent" t WHERE position(${url} in to_jsonb(t)::text) > 0 LIMIT 1`,
  ]);
  return checks.some((rows) => rows.length > 0);
}

export type FileDeleter = (url: string) => Promise<"deleted" | "not-configured">;

/** Deletes from the private photo store (with its recovery-copy handling). Without the store set up it does nothing. */
export const deleteStoredFile: FileDeleter = async (url) => {
  const store = getPrivatePhotoStore();
  if (!store) return "not-configured";
  await deletePrivatePhotoWithRecovery(url, store);
  return "deleted";
};

export type CleanupCounts = { deleted: number; kept: number; failed: number; waiting: number };

/** Nightly: delete every waiting file whose time has come and that nothing uses. Safe to run twice. */
export async function runStoredFileCleanup(
  options: { now?: Date; deleteFile?: FileDeleter } = {},
): Promise<CleanupCounts> {
  const now = options.now ?? new Date();
  const deleteFile = options.deleteFile ?? deleteStoredFile;
  const counts: CleanupCounts = { deleted: 0, kept: 0, failed: 0, waiting: 0 };
  const seen = new Set<string>();
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const due = await prisma.storedFileCleanup.findMany({
      where: { state: "WAITING", deleteAfter: { lte: now }, id: { notIn: [...seen] } },
      orderBy: [{ deleteAfter: "asc" }, { id: "asc" }],
      take: PAGE,
    });
    if (due.length === 0) break;
    for (const row of due) {
      seen.add(row.id);
      try {
        if (await isStoredFileInUse(row.url)) {
          await prisma.storedFileCleanup.updateMany({
            where: { id: row.id, state: "WAITING" },
            data: { state: "KEPT", finishedAt: now, note: "Something started using this file again, so it was kept." },
          });
          counts.kept += 1;
          continue;
        }
        const outcome = await deleteFile(row.url);
        if (outcome === "not-configured") {
          counts.waiting += 1;
          continue;
        }
        await prisma.storedFileCleanup.updateMany({
          where: { id: row.id, state: "WAITING" },
          data: { state: "DELETED", finishedAt: now, attempts: { increment: 1 }, note: null },
        });
        counts.deleted += 1;
      } catch (cause) {
        const attempts = row.attempts + 1;
        const note = (cause instanceof Error ? cause.message : "Unknown problem").replace(/https?:\/\/\S+/gi, "[link]").slice(0, 300);
        const giveUp = attempts >= MAX_ATTEMPTS;
        await prisma.storedFileCleanup.updateMany({
          where: { id: row.id, state: "WAITING" },
          data: { attempts, note, ...(giveUp ? { state: "FAILED", finishedAt: now } : {}) },
        });
        if (giveUp) counts.failed += 1;
        else counts.waiting += 1;
      }
    }
  }
  return counts;
}
