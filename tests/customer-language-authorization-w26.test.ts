import { describe, expect, it, vi, beforeEach } from "vitest";

const mock = vi.hoisted(() => ({
  actor: vi.fn(),
  quote: vi.fn(),
  updateMany: vi.fn(),
  review: vi.fn(),
  transaction: vi.fn(),
  drafts: vi.fn(),
  reviewUpdate:vi.fn(),reviewEvent:vi.fn(),
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
// Exercise an incomplete implementation independently of production source readiness.
vi.mock("@/domains/language/readiness",()=>({allSpanishSurfacesReady:false,CUSTOMER_SPANISH_SURFACE_READINESS:{quote:false}}));
vi.mock("@/domains/language/drafts", () => ({ listCurrentTranslationDrafts: mock.drafts }));

import { chooseQuoteLanguage } from "@/app/estimate/[id]/language-actions";
import { allSpanishSurfacesReady, getSpanishReview, recordSpanishReview, reviewedCopyDigest, spanishCopyDigest } from "@/domains/language/review";

describe("W-26 quote-bearer locale and reviewed-publication safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.actor.mockResolvedValue({id:"owner-id",role:"OWNER",archivedAt:null});
    mock.drafts.mockResolvedValue([]);
    mock.quote.mockResolvedValue({ status: "VIEWED" });
    mock.updateMany.mockResolvedValue({ count: 1 });
    mock.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), user: {findUnique:mock.actor}, customerLanguageReview: { findUnique: mock.review,update:mock.reviewUpdate },customerLanguageReviewEvent:{create:mock.reviewEvent} }));
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
      copyDigest: reviewedCopyDigest([]),
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

  it("invalidates previously approved Spanish after an owner template edit", async () => {
    const source = { kind: "SITE" as const, key: "home.headline", english: "Hello",
      digest: "c".repeat(64), spanish: "Hola", stale: false, revision: 1 };
    mock.review.mockResolvedValue({ copyDigest: reviewedCopyDigest([source]),
      reviewerName: "Fluent reviewer", reviewReference: "Actual evidence",
      reviewedAt: new Date(), legalReviewedAt: new Date(), publishedAt: new Date() });
    mock.drafts.mockResolvedValue([{ ...source, spanish: "Buenos días", revision: 2 }]);
    const state = await getSpanishReview();
    expect(state.currentReview).toBe(false);
    expect(state.enabled).toBe(false);
  });

  it("denies fluent/legal/publication writes from a deactivated or non-owner actor", async () => {
    for (const actor of [null, {id:"admin",role:"ADMIN",archivedAt:null}, {id:"owner-id",role:"OWNER",archivedAt:new Date()}]) {
      mock.actor.mockResolvedValueOnce(actor);
      await expect(recordSpanishReview("owner-id", "PUBLISH",{expectedDigest:reviewedCopyDigest([])})).rejects.toThrow("no longer has access");
    }
  });
  it("rejects an attestation for content different from the displayed fingerprint",async()=>{
    await expect(recordSpanishReview("owner-id","FLUENT",{reviewer:"Synthetic reviewer",reference:"Synthetic test reference",expectedDigest:"a".repeat(64)})).rejects.toThrow("Translation content changed");
  });
  it("allows disabling Spanish even when current translation sources cannot be read",async()=>{
    mock.review.mockResolvedValue({copyDigest:"a".repeat(64),publishedAt:new Date()});
    mock.drafts.mockRejectedValue(new Error("Content unavailable"));
    await expect(recordSpanishReview("owner-id","DISABLE")).resolves.toBeUndefined();
    expect(mock.drafts).not.toHaveBeenCalled();
    expect(mock.reviewUpdate).toHaveBeenCalledWith(expect.objectContaining({data:{publishedAt:null,publishedByUserId:null}}));
  });
  it("refuses owner publication when a W-26 translated customer surface is incomplete", async () => {
    mock.review.mockResolvedValue({
      copyDigest: reviewedCopyDigest([]),
      reviewedAt: new Date(),
      legalReviewedAt: new Date(),
    });
    await expect(recordSpanishReview("owner-id", "PUBLISH",{expectedDigest:reviewedCopyDigest([])})).rejects.toThrow(
      "Complete all W-26 translated customer pages",
    );
    expect(mock.transaction).toHaveBeenCalledOnce();
  });
});

describe("W-26 reviewer digest includes owner-edited mutable content", () => {
  it("rejects a prior approval whenever a Spanish draft changes", () => {
    const old = reviewedCopyDigest([{
      kind: "SITE", key: "home.headline", english: "Hello",
      digest: "a".repeat(64), spanish: "Hola", stale: false, revision: 1,
    }]);
    const changed = reviewedCopyDigest([{
      kind: "SITE", key: "home.headline", english: "Hello",
      digest: "a".repeat(64), spanish: "Buenos días", stale: false, revision: 2,
    }]);
    expect(old).not.toBe(changed);
    expect(spanishCopyDigest()).toMatch(/^[0-9a-f]{64}$/);
  });
});

import { TRANSACTIONAL_COPY } from "@/domains/language/transactional-copy";
it("invalidates reviewed content when transactional Spanish wording changes", () => {
  const before = spanishCopyDigest();
  const copy = TRANSACTIONAL_COPY.es as unknown as Record<string,string>;
  const original = copy.quoteSubject;
  try { copy.quoteSubject = original + " revisado"; expect(spanishCopyDigest()).not.toBe(before); }
  finally { copy.quoteSubject = original; }
});
