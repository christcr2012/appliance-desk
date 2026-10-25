import { beforeEach, describe, expect, it, vi } from "vitest";

// Older review findings: receipt pages live under purchases/<folder>/<file>. They must count as private storage paths,
// otherwise a receipt upload is refused and the nightly clean-up could never delete a removed receipt file.
const blob = vi.hoisted(() => ({ put: vi.fn(async () => ({})), list: vi.fn(async () => ({ blobs: [], hasMore: false })), del: vi.fn(async () => undefined) }));
vi.mock("@vercel/blob", () => blob);

import { isPrivatePhotoPath, privatePhotoPathFromUrl } from "@/lib/photo-storage";
import { deletePrivatePhotoWithRecovery } from "@/domains/backup/media-deletion";

const store = { token: ["test", "token", "for", "mock"].join("-"), storeId: "store_abc123" };
const receiptUrl = "https://abc123.private.blob.vercel-storage.com/purchases/op-12345678/receipt-1.pdf";

beforeEach(() => vi.clearAllMocks());

describe("purchase receipts are private storage paths", () => {
  it("accepts purchases/<folder>/<file> and still refuses look-alikes", () => {
    expect(isPrivatePhotoPath("purchases/op-12345678/receipt-1.pdf")).toBe(true);
    expect(isPrivatePhotoPath("purchases/receipt-1.pdf")).toBe(false);
    expect(isPrivatePhotoPath("purchases/a/b/c.pdf")).toBe(false);
    expect(isPrivatePhotoPath("purchasesX/op-12345678/receipt-1.pdf")).toBe(false);
    expect(isPrivatePhotoPath("../purchases/op-12345678/receipt-1.pdf")).toBe(false);
  });

  it("reads the path from a trusted receipt URL and rejects another store's URL", () => {
    expect(privatePhotoPathFromUrl(receiptUrl, store.storeId)).toBe("purchases/op-12345678/receipt-1.pdf");
    expect(privatePhotoPathFromUrl(receiptUrl.replace("abc123", "evil99"), store.storeId)).toBeNull();
  });

  it("the real deleter removes a receipt file (instead of refusing it as an invalid reference)", async () => {
    await deletePrivatePhotoWithRecovery(receiptUrl, store);
    expect(blob.put).toHaveBeenCalledTimes(1); // the deletion record is written first
    expect(blob.del).toHaveBeenCalledTimes(1);
    expect((blob.del.mock.calls[0] as unknown[])[0]).toEqual([receiptUrl]);
  });
});
