import { describe, expect, it } from "vitest";
import { getBackupStore, privatePhotoPathFromUrl } from "@/lib/photo-storage";

/**
 * Component tests run in a DOM without Node's ReadableStream. Shared photo
 * metadata helpers must not eagerly load @vercel/blob's server Undici client.
 * The real Blob probe remains a lazy server-only operation.
 */
describe("shared photo metadata helpers in the component DOM", () => {
  it("can import private-store helpers without importing the Blob SDK", () => {
    expect(typeof getBackupStore).toBe("function");
    expect(privatePhotoPathFromUrl("https://not-the-store.example/x", "store_synthetic")).toBeNull();
  });
});
