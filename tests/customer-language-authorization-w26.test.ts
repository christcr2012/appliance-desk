import { describe, expect, it, vi, beforeEach } from "vitest";

const mock = vi.hoisted(() => ({
  quote: vi.fn(),
  updateMany: vi.fn(),
  review: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/domains/estimates", () => ({
  getEstimateForApproval: mock.quote,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    estimate: { updateMany: mock.updateMany },
    customerLanguageReview: { findUnique: mock.review },
    $transaction: mock.transaction,
  },
}));
vi.mock("server-only", () => ({}));

import { chooseQuoteLanguage } from "@/app/estimate/[id]/language-actions";
import { allSpanishSurfacesReady, getSpanishReview, recordSpanishReview, spanishCopyDigest } from "@/domains/language/review";

describe("W-26 quote-bearer locale and reviewed-publication safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.quote.mockResolvedValue({ status: "VIEWED" });
    mock.updateMany.mockResolvedValue({ count: 1 });
    mock.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ customerLanguageReview: { findUnique: mock.review } }));
  });

  it("denies invalid language without any read/write", async () => {
    await expect(chooseQuoteLanguage("token", "fr" as "en")).rejects.toThrow("Unsupported");
    expect(mock.quote).not.toHaveBeenCalled();
    expect(mock.updateMany).not.toHaveBeenCalled();
  });

  it("denies expired, unavailable, approved and converted quote bearer links", async () => {
    for (const item of [null, { status: "EXPIRED" }, { status: "APPROVED" }, { status: "CONVERTED" }]) {
      mock.quote.mockResolvedValueOnce(item);
      await expect(chooseQuoteLanguage("token", "es")).rejects.toThrow("no longer available");
    }
    expect(mock.updateMany).not.toHaveBeenCalled();
  });

  it("updates only the exact currently viewable estimate record, never the customer", async () => {
    await expect(chooseQuoteLanguage("opaque-token", "es")).resolves.toBe("es");
    expect(mock.updateMany).toHaveBeenCalledWith({
      where: { id: "opaque-token", status: "VIEWED" },
      data: { preferredLanguage: "es" },
    });
  });

  it("refuses a raced quote invalidation rather than updating an old state", async () => {
    mock.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(chooseQuoteLanguage("stale-link", "es")).rejects.toThrow("no longer available");
  });

  it("stays disabled even with a fake fully-reviewed and published row until complete surface coverage", async () => {
    mock.review.mockResolvedValue({
      copyDigest: spanishCopyDigest(),
      reviewerName: "Independent fluent reviewer",
      reviewReference: "approved copy artifact",
      reviewedAt: new Date(),
      legalReviewerName: "Legal reviewer",
      legalReviewReference: "reviewed agreement",
      legalReviewedAt: new Date(),
      publishedAt: new Date(),
    });
    const snapshot = await getSpanishReview();
    expect(snapshot.currentReview).toBe(true);
    expect(allSpanishSurfacesReady).toBe(false);
    expect(snapshot.enabled).toBe(false);
  });

  it("refuses owner publication when a W-26 translated customer surface is incomplete", async () => {
    mock.review.mockResolvedValue({
      copyDigest: spanishCopyDigest(),
      reviewedAt: new Date(),
      legalReviewedAt: new Date(),
    });
    await expect(recordSpanishReview("owner-id", "PUBLISH")).rejects.toThrow(
      "Complete all W-26 translated customer pages",
    );
    expect(mock.transaction).toHaveBeenCalledOnce();
  });
});
