import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  CLEANUP_GRACE_DAYS, isStoredFileInUse, queueStoredFileCleanup, runStoredFileCleanup, type FileDeleter,
} from "@/domains/stored-files/cleanup";

// Older review findings (photo clean-up): a removed file is deleted only after the waiting period, only when nothing
// still points at it, retried a few times when deleting fails, and never twice. The provider call is a stand-in here.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("stored file clean-up on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const url = (name: string) => `https://example.test/private/cleanup-${tag}/${name}.jpg`;
  const queued: string[] = [];
  const photoIds: string[] = [];
  const now = new Date("2026-11-01T12:00:00Z");
  const later = new Date(now.getTime() + (CLEANUP_GRACE_DAYS + 1) * 86_400_000);

  const queue = async (name: string, graceDays?: number) => {
    const u = url(name);
    queued.push(u);
    await prisma.$transaction((tx) => queueStoredFileCleanup(tx, { url: u, reason: "test", graceDays, now }));
    return u;
  };

  afterAll(async () => {
    await prisma.storedFileCleanup.deleteMany({ where: { url: { in: queued } } });
    await prisma.photo.deleteMany({ where: { id: { in: photoIds } } });
  });

  it("queues once, with the waiting period, and asking again changes nothing", async () => {
    const u = await queue("once");
    expect(await prisma.$transaction((tx) => queueStoredFileCleanup(tx, { url: u, reason: "again", now }))).toBe(false);
    const row = await prisma.storedFileCleanup.findUniqueOrThrow({ where: { url: u } });
    expect(row).toMatchObject({ state: "WAITING", reason: "test", attempts: 0 });
    expect(row.deleteAfter.getTime()).toBe(now.getTime() + CLEANUP_GRACE_DAYS * 86_400_000);
  });

  it("does nothing before the waiting period ends, then deletes once and never again", async () => {
    const u = await queue("wait");
    const deleted: string[] = [];
    const deleteFile: FileDeleter = async (x) => { deleted.push(x); return "deleted"; };
    await runStoredFileCleanup({ now: new Date(now.getTime() + 86_400_000), deleteFile });
    expect(deleted).not.toContain(u);
    const first = await runStoredFileCleanup({ now: later, deleteFile });
    expect(first.deleted).toBeGreaterThanOrEqual(1);
    expect(deleted.filter((x) => x === u)).toHaveLength(1);
    expect((await prisma.storedFileCleanup.findUniqueOrThrow({ where: { url: u } })).state).toBe("DELETED");
    await runStoredFileCleanup({ now: later, deleteFile });
    expect(deleted.filter((x) => x === u)).toHaveLength(1);
  });

  it("uses the owner's waiting periods for each kind of file, and a later change never moves a file already waiting", async () => {
    const before = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { receiptFileKeepDays: true, unsentPhotoKeepDays: true } });
    try {
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { receiptFileKeepDays: 10, unsentPhotoKeepDays: 3 } });
      const receipt = url("owner-receipt"), photo = url("owner-photo");
      queued.push(receipt, photo);
      await prisma.$transaction(async (tx) => {
        await queueStoredFileCleanup(tx, { url: receipt, reason: "test", kind: "receipt", now });
        await queueStoredFileCleanup(tx, { url: photo, reason: "test", kind: "unsent-photo", now });
      });
      const day = 86_400_000;
      expect((await prisma.storedFileCleanup.findUniqueOrThrow({ where: { url: receipt } })).deleteAfter.getTime()).toBe(now.getTime() + 10 * day);
      expect((await prisma.storedFileCleanup.findUniqueOrThrow({ where: { url: photo } })).deleteAfter.getTime()).toBe(now.getTime() + 3 * day);
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { receiptFileKeepDays: 60 } });
      expect((await prisma.storedFileCleanup.findUniqueOrThrow({ where: { url: receipt } })).deleteAfter.getTime()).toBe(now.getTime() + 10 * day);
    } finally {
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: before });
    }
  });

  it("keeps a file that a record points at again, whichever table holds it", async () => {
    const u = await queue("inuse");
    const photo = await prisma.photo.create({ data: { url: u, altText: "back in use" } });
    photoIds.push(photo.id);
    expect(await isStoredFileInUse(u)).toBe(true);
    expect(await isStoredFileInUse(url("never-used"))).toBe(false);
    const deleted: string[] = [];
    const result = await runStoredFileCleanup({ now: later, deleteFile: async (x) => { deleted.push(x); return "deleted"; } });
    expect(result.kept).toBeGreaterThanOrEqual(1);
    expect(deleted).not.toContain(u);
    const row = await prisma.storedFileCleanup.findUniqueOrThrow({ where: { url: u } });
    expect(row.state).toBe("KEPT");
    expect(row.note).toMatch(/started using this file again/);
  });

  it("retries a failing delete on later nights and gives up after five tries, with a plain note and no link", async () => {
    const u = await queue("flaky");
    const deleteFile: FileDeleter = async () => { throw new Error("blob store said no https://secret.example/token"); };
    for (let night = 0; night < 4; night += 1) {
      await runStoredFileCleanup({ now: later, deleteFile });
      const row = await prisma.storedFileCleanup.findUniqueOrThrow({ where: { url: u } });
      expect(row.state).toBe("WAITING");
      expect(row.attempts).toBe(night + 1);
    }
    await runStoredFileCleanup({ now: later, deleteFile });
    const row = await prisma.storedFileCleanup.findUniqueOrThrow({ where: { url: u } });
    expect(row.state).toBe("FAILED");
    expect(row.attempts).toBe(5);
    expect(row.note).toContain("[link]");
    expect(row.note).not.toContain("secret.example");
  });

  it("leaves a file waiting, not failed, when file storage is not set up in this environment", async () => {
    const u = await queue("noconfig");
    const result = await runStoredFileCleanup({ now: later, deleteFile: async () => "not-configured" });
    expect(result.waiting).toBeGreaterThanOrEqual(1);
    expect((await prisma.storedFileCleanup.findUniqueOrThrow({ where: { url: u } })).state).toBe("WAITING");
  });

  it("a photo a customer took off a request before sending goes sooner than a removed receipt", async () => {
    const u = await queue("unsent", 1);
    const row = await prisma.storedFileCleanup.findUniqueOrThrow({ where: { url: u } });
    expect(row.deleteAfter.getTime() - now.getTime()).toBe(86_400_000);
  });

  it("the database refuses a made-up state", async () => {
    await expect(prisma.$executeRaw`UPDATE "StoredFileCleanup" SET "state" = 'LOST' WHERE "url" = ${url("once")}`).rejects.toThrow();
  });
});
