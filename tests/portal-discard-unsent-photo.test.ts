import { beforeEach, describe, expect, it, vi } from "vitest";

// A customer who takes a photo off a request before sending it: only their own uploaded file is queued for clean-up.
const customerFindUnique = vi.fn();
const photoFindFirst = vi.fn();
const queue = vi.fn();

vi.mock("@/lib/prisma", () => {
  const tx = { photo: { findFirst: (...a: unknown[]) => photoFindFirst(...a) } };
  return {
    prisma: {
      customer: { findUnique: (...a: unknown[]) => customerFindUnique(...a) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/domains/messaging/deliver", () => ({ deliverMessage: vi.fn() }));
vi.mock("@/domains/settings", () => ({ getBusinessSettings: vi.fn() }));
vi.mock("@/domains/agreements/active-appliances", () => ({ ACTIVE_ASSIGNMENT_WHERE: {}, getActiveApplianceOptionsForUser: vi.fn() }));
vi.mock("@/domains/stored-files/cleanup", () => ({
  queueStoredFileCleanup: (...a: unknown[]) => queue(...a),
}));
vi.mock("@/lib/photo-storage", () => ({
  getPrivatePhotoStore: () => ({ storeId: "store_abc123", token: "t" }),
  privatePhotoPathFromUrl: (value: string) => {
    const m = /^https:\/\/abc123\.private\.blob\.vercel-storage\.com\/(.+)$/.exec(value);
    return m ? m[1] : null;
  },
}));

import { discardUnsentRequestPhoto } from "@/domains/portal";

const own = "https://abc123.private.blob.vercel-storage.com/maintenance-requests/cust-1/a.jpg";
const theirs = "https://abc123.private.blob.vercel-storage.com/maintenance-requests/cust-2/a.jpg";

describe("discardUnsentRequestPhoto", () => {
  beforeEach(() => {
    customerFindUnique.mockReset().mockResolvedValue({ id: "cust-1" });
    photoFindFirst.mockReset().mockResolvedValue(null);
    queue.mockReset().mockResolvedValue(true);
  });

  it("queues the customer's own unsent photo for tomorrow's clean-up", async () => {
    await discardUnsentRequestPhoto("user-1", own);
    expect(queue).toHaveBeenCalledWith(expect.anything(), { url: own, reason: "customer removed the photo before sending", kind: "unsent-photo" });
  });

  it("ignores another customer's file, a file that is not in the private folder and a signed-out lookup", async () => {
    await discardUnsentRequestPhoto("user-1", theirs);
    await discardUnsentRequestPhoto("user-1", "https://example.com/a.jpg");
    customerFindUnique.mockResolvedValue(null);
    await discardUnsentRequestPhoto("user-9", own);
    expect(queue).not.toHaveBeenCalled();
  });

  it("never queues a photo that a request already uses", async () => {
    photoFindFirst.mockResolvedValue({ id: "photo-1" });
    await discardUnsentRequestPhoto("user-1", own);
    expect(queue).not.toHaveBeenCalled();
  });
});
