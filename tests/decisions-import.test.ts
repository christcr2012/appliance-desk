import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

/**
 * DEC-1b "Import a completed form": the Word file is checked by content, read, previewed and applied only with the
 * preview's confirm token (same fake transaction as tests/decisions-writes.test.ts). Owner only.
 */
const m = vi.hoisted(() => {
  const log: string[] = [];
  const state = {
    role: "OWNER" as string,
    archived: false,
    settings: {
      shortTermLeaseElection: "UNDECIDED", rdfHandling: "UNDECIDED", retailDeliveryFeeDecision: "UNDECIDED",
      badDebtTaxRecovery: "UNDECIDED", setupFeeTaxPlanningTreatment: "TAXABLE", setupFeeTaxTreatment: "UNDECIDED",
      recordRetentionYears: 7,
    } as Record<string, unknown>,
    records: [] as Array<Record<string, unknown>>,
    scheduled: [] as Array<Record<string, unknown>>,
    usedTokens: [] as string[],
  };
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      log.push(sql.includes('"User"') ? "lock:user" : sql.includes('"BusinessSettings"') ? "lock:settings" : "raw");
      return [];
    }),
    user: { findUnique: vi.fn(async () => (log.push("read:user"),
      { id: "owner", role: state.role, archivedAt: state.archived ? new Date() : null })) },
    businessSettings: {
      // DEC-2: acting on a question marks the starting values reviewed.
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => (log.push("read:settings"), { ...state.settings })),
      findUniqueOrThrow: vi.fn(async () => (log.push("read:settings"), { ...state.settings })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        log.push("write:settings");
        Object.assign(state.settings, data);
        return state.settings;
      }),
    },
    taxabilityRule: {
      findMany: vi.fn(async () => [] as unknown[]),
      findFirst: vi.fn(async () => (log.push("read:rule"), { id: "rule-1", taxability: "TAXABLE", provisional: true,
        cpaConfirmedOn: null, reason: "Researched" })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
        (log.push(`write:rule:${String(data.provisional)}`), { id: "rule-1", category: "DELIVERY", ...data })),
      create: vi.fn(async () => (log.push("write:rule:create"), { id: "rule-1", category: "DELIVERY" })),
    },
    taxabilityRuleVersion: {
      count: vi.fn(async () => 1),
      create: vi.fn(async () => (log.push("write:version"), {})),
    },
    // TFA-1: how long records are kept is a dated rule, read when the context loads.
    legalRuleVersion: {
      findMany: vi.fn(async () => [{ id: "rule-version-1", ruleKey: "records.keep_years", value: 7,
        effectiveFrom: new Date("2026-01-01"), origin: "RESEARCHED", undoneAt: null }]),
    },
    taxJurisdiction: { findFirst: vi.fn(async () => null) },
    taxFilingAccount: { findMany: vi.fn(async () => []) },
    decisionRecord: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        log.push(`record:${String(data.kind)}`);
        const row = { id: `rec-${state.records.length + 1}`, createdAt: new Date(), answeredBy: null, ...data };
        state.records.unshift(row);
        return { id: row.id };
      }),
      findMany: vi.fn(async () => state.records),
      findFirst: vi.fn(async () => state.records[0] ?? null),
    },
    decisionScheduledChange: {
      updateMany: vi.fn(async () => (log.push("cancel:pending"), { count: 0 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        log.push("schedule");
        state.scheduled.push(data);
        return { id: "sched-1" };
      }),
      findMany: vi.fn(async () => []),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: { action: string; entityId?: string } }) => {
        log.push(`audit:${data.action}`);
        if (data.action === "decision.answers_applied") state.usedTokens.push(String(data.entityId));
        return {};
      }),
      findFirst: vi.fn(async ({ where }: { where: { entityId: string } }) =>
        state.usedTokens.includes(where.entityId) ? { id: "used" } : null),
    },
  };
  return { log, state, tx, transaction: vi.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)) };
});

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));

const blob = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: blob.put, del: blob.del }));

import { buildQuestionnaire } from "@/domains/decisions/form-content";
import { questionnaireDocx } from "@/domains/decisions/form-files";
import { decisionSubject } from "@/domains/decisions/registry";
import { applyImportedForm, previewImportedForm } from "@/domains/decisions/import";

const HOST = "https://abc123.private.blob.vercel-storage.com";

async function filledForm(): Promise<Uint8Array> {
  const subject = decisionSubject("IN-37-RDF-OWED")!;
  const docx = await questionnaireDocx(buildQuestionnaire({
    audience: "CPA", dateText: "d", business: { name: "n", place: "p", whatItDoes: "w", startedOn: "s" },
    questions: [{ id: subject.id, title: subject.title, question: subject.question, facts: subject.facts,
      doingNow: "Not decided yet", why: null, sources: [], options: subject.options.map((o) => o.label), allowOther: true }],
  }), "t");
  const zip = await JSZip.loadAsync(docx);
  let xml = await zip.file("word/document.xml")!.async("string");
  const plain = subject.options[0]!.label;
  const escaped = plain.replaceAll("'", "&apos;");
  xml = xml.includes(`☐ ${escaped}`) ? xml.replace(`☐ ${escaped}`, `☒ ${escaped}`) : xml.replace(`☐ ${plain}`, `☒ ${plain}`);
  xml = xml.replace("Answered by / firm / date: ________________", "Answered by / firm / date: Pat Lee / Lee CPA / 2026-10-01");
  zip.file("word/document.xml", xml);
  return new Uint8Array(await zip.generateAsync({ type: "nodebuffer" }));
}

beforeEach(() => {
  m.log.length = 0;
  m.state.role = "OWNER";
  m.state.archived = false;
  m.state.records.length = 0;
  m.state.usedTokens.length = 0;
  m.state.settings.retailDeliveryFeeDecision = "UNDECIDED";
  process.env.BETTER_AUTH_SECRET = "a-test-only-secret-that-is-long-enough-123";
  delete process.env.PRIVATE_PHOTO_BLOB_STORE_ID;
  delete process.env.PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN;
  blob.put.mockReset();
  blob.del.mockReset();
});

describe("import a completed form", () => {
  it("reads a filled .docx, previews it, keeps the form privately and applies exactly what was shown", async () => {
    process.env.PRIVATE_PHOTO_BLOB_STORE_ID = "store_AbC123";
    process.env.PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN = ["vercel", "blob", "rw", "AbC123", "testonly"].join("_");
    blob.put.mockImplementation(async (path: string) => ({ url: `${HOST}/${path.replace("completed-form", "completed-form-x1")}` }));
    const preview = await previewImportedForm("owner", { file: await filledForm() });
    expect(preview.file).toBe("KEPT");
    expect(preview.preview).toMatchObject([{ code: "IN-37-RDF-OWED", status: "CHANGE", after: "The business doesn't owe Colorado's retail delivery fee" }]);
    expect(blob.put).toHaveBeenCalledWith("decisions/IN-37-RDF-OWED/completed-form.docx", expect.anything(),
      expect.objectContaining({ access: "private", addRandomSuffix: true }));
    expect(m.state.settings.retailDeliveryFeeDecision).toBe("UNDECIDED");

    // The handle can't be moved to another preview, and the answers can't be swapped.
    await expect(applyImportedForm("owner", { answers: preview.answers, confirmToken: preview.confirmToken + "x",
      attachmentHandle: preview.attachmentHandle })).rejects.toThrow(/expired or isn't yours/);
    await expect(applyImportedForm("owner", { answers: [{ ...preview.answers[0]!, option: "The business owes it" }],
      confirmToken: preview.confirmToken, attachmentHandle: preview.attachmentHandle })).rejects.toThrow(/changed since the preview/);

    const result = await applyImportedForm("owner", { answers: preview.answers, confirmToken: preview.confirmToken,
      attachmentHandle: preview.attachmentHandle });
    expect(result).toMatchObject({ applied: 1, skipped: 0 });
    expect(m.state.settings.retailDeliveryFeeDecision).toBe("NOT_LIABLE");
    expect(m.state.records[0]).toMatchObject({ kind: "PROFESSIONAL_ANSWER", via: "IMPORT", professionalName: "Pat Lee",
      professionalFirm: "Lee CPA", attachmentUrl: `${HOST}/decisions/IN-37-RDF-OWED/completed-form-x1.docx` });
  });

  it("without private storage the answers still preview and apply; the form is just not kept", async () => {
    const preview = await previewImportedForm("owner", { file: await filledForm() });
    expect(preview).toMatchObject({ file: "NOT_KEPT", attachmentHandle: null });
    expect(blob.put).not.toHaveBeenCalled();
    await applyImportedForm("owner", { answers: preview.answers, confirmToken: preview.confirmToken });
    expect(m.state.records[0]).toMatchObject({ attachmentUrl: null });
  });

  it("checks the file by its content: a PDF, a picture or a renamed file is refused before anything is read", async () => {
    await expect(previewImportedForm("owner", { file: new TextEncoder().encode("%PDF-1.7 fake") })).rejects.toThrow(/paste the answers/);
    await expect(previewImportedForm("owner", { file: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) })).rejects.toThrow(/Word/);
    await expect(previewImportedForm("owner", { file: new Uint8Array(4 * 1024 * 1024 + 1) })).rejects.toThrow(/4 MB/);
  });

  it("pasted text with two ticked boxes shows as Can't apply with the reason", async () => {
    const preview = await previewImportedForm("owner", { text: [
      "[DQ-IN-37-RDF-OWED] Owed?",
      "☒ The business doesn't owe Colorado's retail delivery fee",
      "☒ The business owes it",
      "Answered by: Pat",
    ].join("\n") });
    expect(preview.preview).toMatchObject([{ status: "INVALID", reason: "Two answers were ticked." }]);
  });

  it("says plainly when nothing was answered or no codes were found", async () => {
    await expect(previewImportedForm("owner", { text: "[DQ-IN-71] x\n☐ 7 years after the appliance leaves the fleet" }))
      .rejects.toThrow(/No answers were filled in/);
    await expect(previewImportedForm("owner", { text: "hello" })).rejects.toThrow(/No questions were found/);
    await expect(previewImportedForm("owner", {})).rejects.toThrow(/Choose the completed Word form/);
  });

  it("refuses admins and staff (owner only)", async () => {
    for (const role of ["ADMIN", "STAFF"]) {
      m.state.role = role;
      await expect(previewImportedForm("x", { text: "[DQ-IN-71] Answer: 7 years after the appliance leaves the fleet\nAnswered by: A" }))
        .rejects.toThrow(/no longer has access/);
    }
    expect(m.state.records).toEqual([]);
  });
});
