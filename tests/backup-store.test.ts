import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob", () => ({ list }));
import { checkPrivateStoreReady, getBackupStore } from "@/lib/photo-storage";

const privateId = ["store", "SyntheticPrivate"].join("_");
const privateToken = ["vercel", "blob", "rw", "SyntheticPrivate", "fake"].join("_");
const backupId = ["store", "SyntheticBackup"].join("_");
const backupToken = ["vercel", "blob", "rw", "SyntheticBackup", "fake"].join("_");
const publicToken = ["vercel", "blob", "rw", "SyntheticPublic", "fake"].join("_");

beforeEach(() => {
  vi.stubEnv("APP_ENV", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", publicToken);
  vi.stubEnv("PRIVATE_PHOTO_BLOB_STORE_ID", privateId);
  vi.stubEnv("PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN", privateToken);
  vi.stubEnv("BACKUP_BLOB_STORE_ID", undefined);
  vi.stubEnv("BACKUP_BLOB_READ_WRITE_TOKEN", undefined);
  list.mockReset().mockResolvedValue({ blobs: [], hasMore: false });
});
afterEach(() => vi.unstubAllEnvs());

describe("backup destination privacy and readiness", () => {
  it("chooses dedicated verified backup store instead of public/photo stores", () => {
    vi.stubEnv("BACKUP_BLOB_STORE_ID", backupId);
    vi.stubEnv("BACKUP_BLOB_READ_WRITE_TOKEN", backupToken);
    expect(getBackupStore()).toEqual({ token: backupToken, storeId: backupId, source: "backup store" });
  });
  it("falls back only to the independently configured private photo store", () => {
    expect(getBackupStore()).toEqual({ token: privateToken, storeId: privateId, source: "private photo store" });
  });
  it("rejects missing, mismatched or incomplete dedicated config rather than using public or photo tokens", () => {
    vi.stubEnv("BACKUP_BLOB_STORE_ID", backupId);
    expect(getBackupStore()).toBeNull();
    vi.stubEnv("BACKUP_BLOB_READ_WRITE_TOKEN", publicToken);
    expect(getBackupStore()).toBeNull();
    vi.stubEnv("BACKUP_BLOB_READ_WRITE_TOKEN", backupToken);
    vi.stubEnv("BACKUP_BLOB_STORE_ID", "invalid");
    expect(getBackupStore()).toBeNull();
  });
  it("fails closed when no independent private destination is available", () => {
    vi.stubEnv("PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN", undefined);
    vi.stubEnv("PRIVATE_PHOTO_BLOB_STORE_ID", undefined);
    expect(getBackupStore()).toBeNull();
  });
  it("checks actual private-store access and gives safe readiness words", async () => {
    expect(await checkPrivateStoreReady()).toBe("READY");
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ prefix: "jobs/", token: privateToken, limit: 1 }));
    list.mockRejectedValueOnce({ status: 403 });
    expect(await checkPrivateStoreReady()).toBe("ACCESS_DENIED");
    list.mockRejectedValueOnce(new Error("synthetic network interruption"));
    expect(await checkPrivateStoreReady()).toBe("UNREACHABLE");
    vi.stubEnv("PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN", undefined);
    expect(await checkPrivateStoreReady()).toBe("MISSING_TOKEN");
    vi.stubEnv("PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN", privateToken);
    vi.stubEnv("PRIVATE_PHOTO_BLOB_STORE_ID", undefined);
    expect(await checkPrivateStoreReady()).toBe("MISSING_STORE_ID");
    vi.stubEnv("PRIVATE_PHOTO_BLOB_STORE_ID", backupId);
    expect(await checkPrivateStoreReady()).toBe("TOKEN_STORE_MISMATCH");
  });
});
