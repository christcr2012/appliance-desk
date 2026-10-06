import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Stored = {
  bytes: Uint8Array;
  contentType: string;
  uploadedAt: Date;
  etag: string;
};

const PRIVATE_TOKEN = "vercel_blob_rw_test_syntheticvalue";
const BACKUP_TOKEN = "vercel_blob_rw_backup_syntheticvalue";
const PRIVATE_HOST = "test.private.blob.vercel-storage.com";
const BACKUP_HOST = "backup.private.blob.vercel-storage.com";

const state = vi.hoisted(() => ({
  photos: [] as Array<{ id: string; url: string }>,
  stores: new Map<string, Map<string, Stored>>(),
  putOrder: [] as string[],
  delOrder: [] as string[],
}));

function storeFor(token: string): Map<string, Stored> {
  let store = state.stores.get(token);
  if (!store) {
    store = new Map();
    state.stores.set(token, store);
  }
  return store;
}

function hostFor(token: string): string {
  return token === PRIVATE_TOKEN ? PRIVATE_HOST : BACKUP_HOST;
}

function pathnameOf(value: string): string {
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ""));
  } catch {
    return value;
  }
}

function urlFor(token: string, pathname: string): string {
  return `https://${hostFor(token)}/${pathname}`;
}

function bytesOf(value: unknown): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error("Unsupported fake Blob payload.");
}

function seed(token: string, pathname: string, content: string, contentType = "image/jpeg"): string {
  storeFor(token).set(pathname, {
    bytes: new TextEncoder().encode(content),
    contentType,
    uploadedAt: new Date("2026-10-06T00:00:00.000Z"),
    etag: `etag-${createHash("sha256").update(content).digest("hex").slice(0, 12)}`,
  });
  return urlFor(token, pathname);
}

const blob = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  copy: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  list: (...args: unknown[]) => blob.list(...args),
  get: (...args: unknown[]) => blob.get(...args),
  put: (...args: unknown[]) => blob.put(...args),
  copy: (...args: unknown[]) => blob.copy(...args),
  del: (...args: unknown[]) => blob.del(...args),
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    photo: {
      findMany: vi.fn(async () => [...state.photos].sort((a, b) => a.id.localeCompare(b.id))),
    },
  },
}));

import {
  restoreMediaFromManifest,
  runMediaInventoryAndCopy,
  verifyMediaRecoverySample,
} from "../scripts/media-inventory";
import {
  deletePrivatePhotoWithRecovery,
  deletePrivatePhotosWithRecovery,
  privacyDeletionTombstonePath,
} from "@/domains/backup/media-deletion";

function installBlobFake(): void {
  blob.list.mockImplementation(async (options: {
    prefix?: string;
    token?: string;
    cursor?: string;
    limit?: number;
  } = {}) => {
    const token = options.token ?? "";
    const prefix = options.prefix ?? "";
    const rows = [...storeFor(token).entries()]
      .filter(([pathname]) => pathname.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pathname, value]) => ({
        pathname,
        url: urlFor(token, pathname),
        downloadUrl: `${urlFor(token, pathname)}?download=1`,
        size: value.bytes.byteLength,
        uploadedAt: value.uploadedAt,
        etag: value.etag,
      }));
    return { blobs: rows, hasMore: false, cursor: undefined };
  });

  blob.get.mockImplementation(async (value: string, options: { token?: string }) => {
    const token = options.token ?? "";
    const pathname = pathnameOf(value);
    const item = storeFor(token).get(pathname);
    if (!item) return null;
    return {
      statusCode: 200,
      stream: new Blob([item.bytes as BlobPart]).stream(),
      headers: new Headers(),
      blob: {
        pathname,
        url: urlFor(token, pathname),
        downloadUrl: `${urlFor(token, pathname)}?download=1`,
        size: item.bytes.byteLength,
        uploadedAt: item.uploadedAt,
        etag: item.etag,
        contentType: item.contentType,
        contentDisposition: "",
        cacheControl: "",
      },
    };
  });

  blob.put.mockImplementation(async (
    pathname: string,
    body: unknown,
    options: { token?: string; contentType?: string; allowOverwrite?: boolean; ifMatch?: string },
  ) => {
    const token = options.token ?? "";
    const target = storeFor(token);
    if (target.has(pathname) && options.allowOverwrite === false) {
      throw new Error("fake Blob destination already exists");
    }
    const bytes = bytesOf(body);
    target.set(pathname, {
      bytes,
      contentType: options.contentType ?? "application/octet-stream",
      uploadedAt: new Date(),
      etag: `etag-put-${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`,
    });
    state.putOrder.push(pathname);
    return {
      pathname,
      url: urlFor(token, pathname),
      downloadUrl: `${urlFor(token, pathname)}?download=1`,
      contentType: options.contentType ?? "application/octet-stream",
      contentDisposition: "",
      etag: target.get(pathname)!.etag,
    };
  });

  blob.copy.mockImplementation(async (
    from: string,
    to: string,
    options: { token?: string; contentType?: string; allowOverwrite?: boolean },
  ) => {
    const token = options.token ?? "";
    const target = storeFor(token);
    const source = target.get(pathnameOf(from));
    if (!source) throw new Error(`fake Blob source missing: ${from}`);
    if (options.ifMatch && options.ifMatch !== source.etag) {
      throw new Error("fake Blob source changed");
    }
    if (target.has(to) && options.allowOverwrite === false) {
      throw new Error("fake Blob destination already exists");
    }
    target.set(to, {
      bytes: new Uint8Array(source.bytes),
      contentType: options.contentType ?? source.contentType,
      uploadedAt: new Date(),
      etag: `etag-copy-${createHash("sha256").update(source.bytes).digest("hex").slice(0, 12)}`,
    });
    return {
      pathname: to,
      url: urlFor(token, to),
      downloadUrl: `${urlFor(token, to)}?download=1`,
      contentType: options.contentType ?? source.contentType,
      contentDisposition: "",
      etag: target.get(to)!.etag,
    };
  });

  blob.del.mockImplementation(async (
    values: string | string[],
    options: { token?: string },
  ) => {
    const token = options.token ?? "";
    for (const value of Array.isArray(values) ? values : [values]) {
      const pathname = pathnameOf(value);
      storeFor(token).delete(pathname);
      state.delOrder.push(pathname);
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.photos.length = 0;
  state.stores.clear();
  state.putOrder.length = 0;
  state.delOrder.length = 0;
  process.env.PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN = PRIVATE_TOKEN;
  process.env.PRIVATE_PHOTO_BLOB_STORE_ID = "store_test";
  process.env.BLOB_READ_WRITE_TOKEN = BACKUP_TOKEN;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  installBlobFake();
});

describe("Batch F private-media recovery", () => {
  it("hashes every referenced photo, copies it, and reports an orphan without deleting it", async () => {
    const firstPath = "jobs/job-1/photo-a.jpg";
    const secondPath = "maintenance-requests/request-1/photo-b.png";
    const orphanPath = "appliances/appliance-orphan/orphan.jpg";
    const firstUrl = seed(PRIVATE_TOKEN, firstPath, "alpha");
    const secondUrl = seed(PRIVATE_TOKEN, secondPath, "bravo", "image/png");
    seed(PRIVATE_TOKEN, orphanPath, "orphan");
    state.photos.push(
      { id: "photo-a", url: firstUrl },
      { id: "photo-b", url: secondUrl },
    );

    const result = await runMediaInventoryAndCopy({
      databaseBackupUrl: `https://${BACKUP_HOST}/backups/2026-10-06-1.json`,
      now: new Date("2026-10-06T09:00:00.000Z"),
    });

    const alphaHash = createHash("sha256").update("alpha").digest("hex");
    expect(result.manifest.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          photoId: "photo-a",
          sourcePath: firstPath,
          size: 5,
          sha256: alphaHash,
          status: "COPIED",
          recoveryPath: `recovery/2026-10/${alphaHash}/${firstPath}`,
        }),
        expect.objectContaining({
          photoId: "photo-b",
          sourcePath: secondPath,
          size: 5,
          status: "COPIED",
        }),
      ]),
    );
    expect(result.manifest.unreferenced).toEqual([
      expect.objectContaining({ pathname: orphanPath, tombstoned: false }),
    ]);
    expect(storeFor(PRIVATE_TOKEN).has(orphanPath)).toBe(true);
    expect(state.delOrder).toEqual([]);
    expect(pathnameOf(result.manifestUrl)).toBe(
      "backups/2026-10-06-1.json.media.json",
    );

    await expect(verifyMediaRecoverySample(result.manifestUrl, 2)).resolves.toEqual({
      checked: 2,
      skippedTombstoned: 0,
    });
  });

  it("keeps old recovery bytes when a source changes later in the same month", async () => {
    const sourcePath = "jobs/job-2/photo.jpg";
    const sourceUrl = seed(PRIVATE_TOKEN, sourcePath, "version-one");
    state.photos.push({ id: "photo-versioned", url: sourceUrl });

    const first = await runMediaInventoryAndCopy({
      databaseBackupUrl: `https://${BACKUP_HOST}/backups/2026-10-06-2.json`,
      now: new Date("2026-10-06T09:00:00.000Z"),
    });
    const firstPath = first.manifest.entries[0]!.recoveryPath!;

    seed(PRIVATE_TOKEN, sourcePath, "version-two");
    const second = await runMediaInventoryAndCopy({
      databaseBackupUrl: `https://${BACKUP_HOST}/backups/2026-10-07-1.json`,
      now: new Date("2026-10-07T09:00:00.000Z"),
    });
    const secondPath = second.manifest.entries[0]!.recoveryPath!;

    expect(secondPath).not.toBe(firstPath);
    expect(storeFor(PRIVATE_TOKEN).has(firstPath)).toBe(true);
    expect(storeFor(PRIVATE_TOKEN).has(secondPath)).toBe(true);
    await expect(verifyMediaRecoverySample(first.manifestUrl, 1)).resolves.toEqual({
      checked: 1,
      skippedTombstoned: 0,
    });
  });

  it("writes a tombstone before deleting primary and recovery bytes", async () => {
    const sourcePath = "maintenance-requests/request-delete/private.jpg";
    const sourceUrl = seed(PRIVATE_TOKEN, sourcePath, "private");
    const recoveryOne = `recovery/2026-09/oldhash/${sourcePath}`;
    const recoveryTwo = `recovery/2026-10/newhash/${sourcePath}`;
    seed(PRIVATE_TOKEN, recoveryOne, "private");
    seed(PRIVATE_TOKEN, recoveryTwo, "private");
    const unrelated = "recovery/2026-10/hash/jobs/other/photo.jpg";
    seed(PRIVATE_TOKEN, unrelated, "keep");

    await deletePrivatePhotoWithRecovery(sourceUrl, {
      token: PRIVATE_TOKEN,
      storeId: "store_test",
    });

    const tombstone = privacyDeletionTombstonePath(sourcePath);
    expect(storeFor(PRIVATE_TOKEN).has(tombstone)).toBe(true);
    expect(storeFor(PRIVATE_TOKEN).has(sourcePath)).toBe(false);
    expect(storeFor(PRIVATE_TOKEN).has(recoveryOne)).toBe(false);
    expect(storeFor(PRIVATE_TOKEN).has(recoveryTwo)).toBe(false);
    expect(storeFor(PRIVATE_TOKEN).has(unrelated)).toBe(true);
    expect(blob.put.mock.invocationCallOrder.at(-1)).toBeLessThan(
      blob.del.mock.invocationCallOrder.at(-1)!,
    );
  });

  it("never restores a photo after privacy deletion, even from an older manifest", async () => {
    const sourcePath = "jobs/job-private/photo.jpg";
    const sourceUrl = seed(PRIVATE_TOKEN, sourcePath, "customer-private");
    state.photos.push({ id: "photo-private", url: sourceUrl });
    const backup = await runMediaInventoryAndCopy({
      databaseBackupUrl: `https://${BACKUP_HOST}/backups/2026-10-06-private.json`,
      now: new Date("2026-10-06T09:00:00.000Z"),
    });

    await deletePrivatePhotoWithRecovery(sourceUrl, {
      token: PRIVATE_TOKEN,
      storeId: "store_test",
    });
    expect(storeFor(PRIVATE_TOKEN).has(sourcePath)).toBe(false);

    const copyCallsBeforeRestore = blob.copy.mock.calls.length;
    await expect(restoreMediaFromManifest(backup.manifestUrl)).resolves.toEqual({
      restored: 0,
      alreadyPresent: 0,
      skippedTombstoned: 1,
    });
    expect(blob.copy.mock.calls.length).toBe(copyCallsBeforeRestore);
    expect(storeFor(PRIVATE_TOKEN).has(sourcePath)).toBe(false);
  });

  it("restores a missing primary only after verifying the recovery bytes", async () => {
    const sourcePath = "jobs/job-restore/photo.jpg";
    const sourceUrl = seed(PRIVATE_TOKEN, sourcePath, "recoverable");
    state.photos.push({ id: "photo-restore", url: sourceUrl });
    const backup = await runMediaInventoryAndCopy({
      databaseBackupUrl: `https://${BACKUP_HOST}/backups/2026-10-06-restore.json`,
      now: new Date("2026-10-06T09:00:00.000Z"),
    });
    storeFor(PRIVATE_TOKEN).delete(sourcePath);

    await expect(restoreMediaFromManifest(backup.manifestUrl)).resolves.toEqual({
      restored: 1,
      alreadyPresent: 0,
      skippedTombstoned: 0,
    });
    expect(new TextDecoder().decode(storeFor(PRIVATE_TOKEN).get(sourcePath)!.bytes)).toBe(
      "recoverable",
    );
  });

  it("removes a just-restored primary when privacy deletion races the restore", async () => {
    const sourcePath = "jobs/job-race/photo.jpg";
    const sourceUrl = seed(PRIVATE_TOKEN, sourcePath, "race-bytes");
    state.photos.push({ id: "photo-race", url: sourceUrl });
    const backup = await runMediaInventoryAndCopy({
      databaseBackupUrl: `https://${BACKUP_HOST}/backups/2026-10-06-race.json`,
      now: new Date("2026-10-06T09:00:00.000Z"),
    });
    storeFor(PRIVATE_TOKEN).delete(sourcePath);

    const originalCopy = blob.copy.getMockImplementation()!;
    blob.copy.mockImplementationOnce(async (...args: unknown[]) => {
      const result = await originalCopy(...args);
      seed(
        PRIVATE_TOKEN,
        privacyDeletionTombstonePath(sourcePath),
        JSON.stringify({ status: "PRIVACY_DELETED", sourcePath }),
        "application/json",
      );
      return result;
    });

    await expect(restoreMediaFromManifest(backup.manifestUrl)).resolves.toEqual({
      restored: 0,
      alreadyPresent: 0,
      skippedTombstoned: 1,
    });
    expect(storeFor(PRIVATE_TOKEN).has(sourcePath)).toBe(false);
  });

  it("validates and tombstones a set before deleting any of its bytes", async () => {
    const firstPath = "maintenance-requests/customer-1/first.jpg";
    const secondPath = "maintenance-requests/customer-1/second.jpg";
    const first = seed(PRIVATE_TOKEN, firstPath, "first");
    const second = seed(PRIVATE_TOKEN, secondPath, "second");

    await deletePrivatePhotosWithRecovery(
      [first, second],
      { token: PRIVATE_TOKEN, storeId: "store_test" },
      { privacyRequestId: "privacy-1", deletedAt: new Date("2026-10-06T12:00:00Z") },
    );

    expect(state.putOrder).toEqual(
      expect.arrayContaining([
        privacyDeletionTombstonePath(firstPath),
        privacyDeletionTombstonePath(secondPath),
      ]),
    );
    const firstDeleteOrder = blob.del.mock.invocationCallOrder[0]!;
    expect(blob.put.mock.invocationCallOrder.at(-1)).toBeLessThan(firstDeleteOrder);
    expect(storeFor(PRIVATE_TOKEN).has(firstPath)).toBe(false);
    expect(storeFor(PRIVATE_TOKEN).has(secondPath)).toBe(false);
  });

});
