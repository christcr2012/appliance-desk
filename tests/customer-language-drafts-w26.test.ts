import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  publicCopy: vi.fn(),
  template: vi.fn(),
  existing: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  audit: vi.fn(),
  legal:vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/domains/language/legal",()=>({legalTranslationSources:mocks.legal}));
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
    callback({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), user: { findUnique: mocks.actor }, customerTranslationDraft: {
      findUnique: mocks.existing, create: mocks.create, updateMany: mocks.updateMany,
    }, auditLog: { create: mocks.audit } }),
} }));
import { currentTranslationSource, saveTranslationDraft } from "@/domains/language/drafts";

describe("W-26 owner-managed Spanish drafts never publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({id:"owner",role:"OWNER",archivedAt:null});
    mocks.publicCopy.mockResolvedValue({ "home.headline": "English on site" });
    mocks.existing.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "draft-1" });
    mocks.audit.mockResolvedValue({});
  });
  it("retains a complete supported legal counterpart longer than ordinary UI copy",async()=>{
    const english="Legal wording ".repeat(350);const spanish="Traducción informativa completa ".repeat(200);
    mocks.legal.mockResolvedValue(new Map([["a".repeat(64),english]]));
    const source=await currentTranslationSource("LEGAL","a".repeat(64));
    await expect(saveTranslationDraft("owner","LEGAL","a".repeat(64),source.digest,null,spanish)).resolves.toBe(1);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({spanishText:spanish.trim()})}));
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
  it("denies archived or non-staff actors at the write boundary", async () => {
    const source = await currentTranslationSource("SITE", "home.headline");
    for (const actor of [null, {id:"customer",role:"CUSTOMER",archivedAt:null}, {id:"owner",role:"OWNER",archivedAt:new Date()}]) {
      mocks.actor.mockResolvedValueOnce(actor);
      await expect(saveTranslationDraft("owner", "SITE", "home.headline", source.digest, null, "Hola")).rejects.toThrow("no longer has access");
    }
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
  it("preserves communication placeholders without introducing invented recipient variables", async () => {
    mocks.template.mockResolvedValue({ isCurrent: true, subject: "Hi {{firstName}}", body: "Body {{amount}}" });
    const part = await currentTranslationSource("COMMUNICATION", "rev123:body");
    await expect(saveTranslationDraft("owner", "COMMUNICATION", "rev123:body", part.digest, null,
      "Texto sin el importe")).rejects.toThrow("template variables");
    await expect(saveTranslationDraft("owner", "COMMUNICATION", "rev123:body", part.digest, null,
      "Total {{amount}} a {{otherCustomer}}")).rejects.toThrow("template variables");
    await expect(saveTranslationDraft("owner", "COMMUNICATION", "rev123:body", part.digest, null,
      "Importe {{amount}}")).resolves.toBe(1);
  });

  it("requires actual current templates, not deleted revisions", async () => {
    mocks.template.mockResolvedValue({ isCurrent: false, subject: "Old", body: "text" });
    await expect(currentTranslationSource("COMMUNICATION", "old-revision")).rejects.toThrow();
  });
});
