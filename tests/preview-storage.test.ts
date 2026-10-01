import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/session", () => ({ getServerSession: mocks.session }));
vi.mock("@vercel/blob", () => ({ put: mocks.put, get: mocks.get, del: mocks.del }));
import { PREVIEW_PRIVATE_STORE_ID, previewStorageConfigured, verifyPreviewPrivateStorage } from "@/domains/preview-storage";

const token = "vercel_blob_rw_6Sttks2ULJ8wG5hl_synthetic";
const anonymous = vi.fn();
let ownedPath: string;
let ownedContent: string;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PREVIEW_PRIVATE_BLOB_STORE_ID", PREVIEW_PRIVATE_STORE_ID);
  vi.stubEnv("PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN", token);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "production-must-never-be-used");
  vi.stubGlobal("fetch", anonymous);
  mocks.session.mockResolvedValue({ user: { id: "owner", role: "OWNER", archivedAt: null } });
  mocks.put.mockImplementation(async (path: string, content: string) => {
    ownedPath = path;
    ownedContent = content;
    return { pathname: path, url: `https://6sttks2ulj8wg5hl.private.blob.vercel-storage.com/${path}` };
  });
  mocks.get.mockImplementationOnce(async () => ({
    statusCode: 200, blob: { pathname: ownedPath }, stream: new Response(ownedContent).body,
  })).mockResolvedValue(null);
  mocks.del.mockResolvedValue(undefined);
  anonymous.mockResolvedValue(new Response("Forbidden", { status: 403 }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("private preview runtime check", () => {
  it.each([undefined, "production", "development", "unknown"])("refuses environment %s before any file operation", async (environment) => {
    vi.stubEnv("VERCEL_ENV", environment);
    expect(previewStorageConfigured()).toBe(false);
    expect((await verifyPreviewPrivateStorage()).status).toBe("error");
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it.each([null, { user: { role: "ADMIN" } }, { user: { role: "STAFF" } }, { user: { role: "CUSTOMER" } }])("rejects unauthorized identity %j", async (identity) => {
    mocks.session.mockResolvedValue(identity);
    expect((await verifyPreviewPrivateStorage()).status).toBe("error");
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it.each(["", "vercel_blob_rw_KPHIdNdaYTgGP2v5_production", "invalid-secret"])("never falls back from wrong/missing preview credential", async (credential) => {
    vi.stubEnv("PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN", credential);
    const result = await verifyPreviewPrivateStorage();
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain(credential || "production-must-never-be-used");
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("refuses an unverified store even with the correct token", async () => {
    vi.stubEnv("PREVIEW_PRIVATE_BLOB_STORE_ID", "store_KPHIdNdaYTgGP2v5");
    expect((await verifyPreviewPrivateStorage()).status).toBe("error");
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("writes/reads only its generated path, denies anonymous access, then verifies cleanup", async () => {
    const result = await verifyPreviewPrivateStorage();
    expect(result.status).toBe("passed");
    expect(result.fixturePath).toMatch(/^preview-checks\/[0-9a-f-]{36}\.txt$/);
    expect(mocks.put).toHaveBeenCalledWith(ownedPath, ownedContent, expect.objectContaining({
      token, access: "private", addRandomSuffix: false, allowOverwrite: false,
    }));
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.get).toHaveBeenCalledWith(ownedPath, expect.objectContaining({ token, access: "private", useCache: false }));
    expect(anonymous).toHaveBeenCalledWith(`https://6sttks2ulj8wg5hl.private.blob.vercel-storage.com/${ownedPath}`,
      expect.objectContaining({ credentials: "omit", redirect: "error", cache: "no-store" }));
    expect(mocks.del).toHaveBeenCalledWith(ownedPath, expect.objectContaining({ token }));
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("reports public access as failure even when the authenticated read matches", async () => {
    anonymous.mockResolvedValue(new Response(ownedContent, { status: 200 }));
    expect((await verifyPreviewPrivateStorage()).status).toBe("error");
    expect(mocks.del).toHaveBeenCalled();
  });

  it("rejects wrong contents and still cleans up", async () => {
    mocks.get.mockReset().mockImplementationOnce(async () => ({ statusCode: 200,
      blob: { pathname: ownedPath }, stream: new Response("wrong").body })).mockResolvedValue(null);
    expect((await verifyPreviewPrivateStorage()).status).toBe("error");
    expect(anonymous).not.toHaveBeenCalled();
    expect(mocks.del).toHaveBeenCalled();
  });

  it("does not fetch provider-returned URLs outside the verified private store", async () => {
    mocks.put.mockImplementation(async (path: string) => ({ pathname: path, url: `https://example.com/${path}` }));
    mocks.get.mockReset().mockResolvedValue(null);
    expect((await verifyPreviewPrivateStorage()).status).toBe("error");
    expect(anonymous).not.toHaveBeenCalled();
    expect(mocks.del).toHaveBeenCalledWith(expect.stringMatching(/^preview-checks\//), expect.objectContaining({ token }));
  });

  it("cleans up uncertain writes without leaking provider error details", async () => {
    mocks.put.mockRejectedValue(new Error(`network timeout ${token}`));
    mocks.get.mockReset().mockResolvedValue(null);
    const result = await verifyPreviewPrivateStorage();
    expect(result.status).toBe("error");
    expect(mocks.del).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("does not claim success when cleanup fails", async () => {
    mocks.del.mockRejectedValue(new Error("delete failed"));
    const result = await verifyPreviewPrivateStorage();
    expect(result.status).toBe("error");
    expect(result.message).toContain("Cleanup could not be verified");
    expect(result.fixturePath).toBe(ownedPath);
    expect(result.cleanupPending).toBe(true);
  });
});
