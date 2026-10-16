import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  publicCopy: vi.fn(),
  template: vi.fn(),
  existing: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/domains/site-content", () => ({ getPublishedContent: mocks.publicCopy }));
vi.mock("@/domains/site-content/fields", () => ({
  siteFieldByKey: (key: string) => key === "home.headline"
    ? { key, default: "Original English", kind: "short" } : undefined,
  SITE_FIELDS: [{ key: "home.headline", default: "Original English", kind: "short" }],
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  communicationTemplateRevision: { findUnique: mocks.template, findMany: vi.fn().mockResolvedValue([]) },
  customerTranslationDraft: {
    findUnique: mocks.existing,
    create: mocks.create,
    updateMany: mocks.updateMany,
    findMany: vi.fn().mockResolvedValue([]),
  },
  auditLog: { create: mocks.audit },
  $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ customerTranslationDraft: {
      findUnique: mocks.existing, create: mocks.create, updateMany: mocks.updateMany,
    }, auditLog: { create: mocks.audit } }),
} }));
import { currentTranslationSource, saveTranslationDraft } from "@/domains/language/drafts";

describe("W-26 owner-managed Spanish drafts never publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publicCopy.mockResolvedValue({ "home.headline": "English on site" });
    mocks.existing.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "draft-1" });
    mocks.audit.mockResolvedValue({});
  });
  it("resolves the canonical English, not user-provided English", async () => {
    const source = await currentTranslationSource("SITE", "home.headline");
    expect(source.english).toBe("English on site");
    expect(source.digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it("refuses non-whitelisted, URL, and other source keys", async () => {
    await expect(currentTranslationSource("SITE", "arbitrary")).rejects.toThrow();
    await expect(currentTranslationSource("SITE", "../../../secrets")).rejects.toThrow();
  });
  it("does not save stale Spanish after English source changes", async () => {
    const { digest } = await currentTranslationSource("SITE", "home.headline");
    mocks.publicCopy.mockResolvedValue({ "home.headline": "Updated English" });
    await expect(saveTranslationDraft("owner", "SITE", "home.headline", digest, null, "Hola"))
      .rejects.toThrow("English wording changed");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("inserts a private reviewed-source-bound draft, not a published website revision", async () => {
    const source = await currentTranslationSource("SITE", "home.headline");
    await expect(saveTranslationDraft("owner", "SITE", "home.headline", source.digest, null, "Mi título"))
      .resolves.toBe(1);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      sourceKind: "SITE", spanishText: "Mi título", englishDigest: source.digest,
    }) });
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it("refuses a stale owner edit with wrong revision", async () => {
    mocks.existing.mockResolvedValue({ id: "draft", revision: 4 });
    const source = await currentTranslationSource("SITE", "home.headline");
    await expect(saveTranslationDraft("owner", "SITE", "home.headline", source.digest, 3, "Nuevo"))
      .rejects.toThrow("Another editor");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("requires actual current templates, not deleted revisions", async () => {
    mocks.template.mockResolvedValue({ isCurrent: false, subject: "Old", body: "text" });
    await expect(currentTranslationSource("COMMUNICATION", "old-revision")).rejects.toThrow();
  });
});
