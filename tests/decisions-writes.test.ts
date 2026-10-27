import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Decisions & reviews writes with fakes (DEC-1a). The fake transaction records every call in order so the tests can
 * prove the owner is re-checked and the settings row is locked before anything is written, and that refused writes
 * write nothing. The same behaviour runs on real PostgreSQL in tests/decisions-integration.test.ts.
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
    // TFA-1: how long records are kept is a dated rule, so the context load
    // reads it here instead of the settings row.
    legalRuleVersion: {
      findMany: vi.fn(async () => (log.push("read:rule-version"),
        [{ id: "rule-version-1", ruleKey: "records.keep_years", value: 7,
          effectiveFrom: new Date("2026-01-01"), origin: "RESEARCHED", undoneAt: null }])),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
        (log.push("write:rule-version"), { id: "rule-version-2", ...data })),
      update: vi.fn(async () => (log.push("write:rule-version:update"), {})),
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

import {
  applyAnswers,
  changeDecision,
  confirmDecision,
  listDecisions,
  previewAnswers,
  recordProfessionalAnswer,
  sendToProfessional,
} from "@/domains/decisions";

const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
function dayAfter(key: string, days: number) {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d! + days)).toISOString().slice(0, 10);
}

beforeEach(() => {
  m.log.length = 0;
  m.transaction.mockClear();
  m.state.role = "OWNER";
  m.state.archived = false;
  m.state.records.length = 0;
  m.state.scheduled.length = 0;
  m.state.usedTokens.length = 0;
  m.state.settings.retailDeliveryFeeDecision = "UNDECIDED";
  m.state.settings.rdfHandling = "UNDECIDED";
  process.env.BETTER_AUTH_SECRET = "a-test-only-secret-that-is-long-enough-123";
});

describe("who may read and write decisions", () => {
  it("lets the owner and admins read, and refuses staff", async () => {
    m.state.role = "ADMIN";
    const cards = await listDecisions("admin");
    expect(cards.length).toBeGreaterThan(30);
    expect(cards.find((card) => card.id === "IN-37-RDF-OWED")).toMatchObject({
      state: "STARTING_VALUE", current: { value: "UNDECIDED" }, audience: "CPA" });
    m.state.role = "STAFF";
    await expect(listDecisions("staff")).rejects.toThrow(/no longer has access/);
    m.state.role = "CUSTOMER";
    await expect(listDecisions("customer")).rejects.toThrow(/no longer has access/);
  });

  it("refuses every write for admins and staff before anything is written", async () => {
    for (const role of ["ADMIN", "STAFF"]) {
      m.state.role = role;
      m.log.length = 0;
      await expect(changeDecision("x", "IN-37-RDF-OWED", "NOT_LIABLE", null)).rejects.toThrow(/no longer has access/);
      await expect(confirmDecision("x", "IN-71", 7)).rejects.toThrow(/no longer has access/);
      await expect(sendToProfessional("x", "IN-71", "CPA")).rejects.toThrow(/no longer has access/);
      expect(m.log.filter((entry) => /^(write|record|schedule|audit)/.test(entry))).toEqual([]);
    }
    m.state.role = "OWNER";
    m.state.archived = true;
    await expect(changeDecision("owner", "IN-37-RDF-OWED", "NOT_LIABLE", null)).rejects.toThrow(/no longer has access/);
  });
});

describe("changing a decision", () => {
  it("re-checks the owner, locks the settings row, then saves through the setting's own save and records it", async () => {
    await changeDecision("owner", "IN-37-RDF-OWED", "NOT_LIABLE", null, "Per CPA call");
    const order = m.log.filter((entry) => !entry.startsWith("read:"));
    expect(order.slice(0, 2)).toEqual(["lock:user", "lock:settings"]);
    expect(order).toContain("write:settings");
    expect(order.indexOf("cancel:pending")).toBeLessThan(order.indexOf("record:CHANGED"));
    expect(m.state.settings.retailDeliveryFeeDecision).toBe("NOT_LIABLE");
    expect(m.tx.decisionRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      subjectId: "IN-37-RDF-OWED", kind: "CHANGED", value: "NOT_LIABLE", previousValue: "UNDECIDED",
      audience: "OWNER", via: "SCREEN", explanation: "Per CPA call", answeredByUserId: "owner" }) }));
    expect(m.log).toContain("audit:decision.changed");
    expect(m.log).toContain("audit:tax.setup.settings_updated");
  });

  it("refuses a date in the past and writes nothing", async () => {
    await expect(changeDecision("owner", "IN-37-RDF-OWED", "NOT_LIABLE", dayAfter(TODAY, -1)))
      .rejects.toThrow("A change can't apply to the past — signed and billed history stays as it was.");
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.log).toEqual([]);
  });

  it("keeps a change for a later date without touching the setting today", async () => {
    await changeDecision("owner", "IN-37-RDF-OWED", "COLLECT", dayAfter(TODAY, 3));
    expect(m.state.settings.retailDeliveryFeeDecision).toBe("UNDECIDED");
    expect(m.log).not.toContain("write:settings");
    expect(m.state.scheduled).toEqual([expect.objectContaining({ subjectId: "IN-37-RDF-OWED", value: "COLLECT",
      decisionRecordId: "rec-1", provisional: false })]);
    expect(m.log.indexOf("cancel:pending")).toBeGreaterThan(-1);
  });

  it("refuses answers that are not one of the choices", async () => {
    await expect(changeDecision("owner", "IN-37-RDF-OWED", "PAY_MYSELF", null)).rejects.toThrow(/isn't one of the choices/);
    await expect(changeDecision("owner", "NOT-A-CODE", "X", null)).rejects.toThrow(/isn't in Decisions/);
    expect(m.log).toEqual([]);
  });
});

describe("keeping the current value", () => {
  it("refuses when the value changed since the screen was opened", async () => {
    m.state.settings.rdfHandling = "PAY_MYSELF";
    await expect(confirmDecision("owner", "IN-37-RDF", "COLLECT_FROM_CUSTOMER"))
      .rejects.toThrow("This changed since you opened it. Refresh to see the latest.");
    expect(m.log.some((entry) => entry.startsWith("record:"))).toBe(false);
  });

  it("refuses to 'keep' a value that was never decided", async () => {
    await expect(confirmDecision("owner", "IN-37-RDF", "UNDECIDED")).rejects.toThrow(/Nothing is set yet/);
  });

  it("confirms a provisional tax starting value through the tax setup save, keeping history", async () => {
    m.tx.taxabilityRule.findMany.mockResolvedValueOnce([{ id: "rule-1", jurisdictionId: null, category: "DELIVERY",
      taxability: "TAXABLE", cpaConfirmedOn: null, provisional: true }]);
    await confirmDecision("owner", "IN-34-DELIVERY-STATE", "TAXABLE");
    expect(m.log).toContain("write:rule:false");
    expect(m.log).toContain("write:version");
    expect(m.log).toContain("audit:tax.setup.taxability_confirmed");
    expect(m.tx.taxabilityRule.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      taxability: "TAXABLE", provisional: false, reason: "Confirmed by the owner in Decisions & reviews" }) }));
  });

  it("never replaces a CPA's confirmation date when the owner keeps a confirmed tax rule", async () => {
    m.tx.taxabilityRule.findMany.mockResolvedValueOnce([{ id: "rule-1", jurisdictionId: null, category: "DELIVERY",
      taxability: "TAXABLE", cpaConfirmedOn: new Date("2026-09-01"), provisional: false }]);
    m.tx.taxabilityRule.update.mockClear();
    await confirmDecision("owner", "IN-34-DELIVERY-STATE", "TAXABLE");
    expect(m.tx.taxabilityRule.update).not.toHaveBeenCalled();
    expect(m.log).toContain("record:CONFIRMED");
  });

  it("records a confirmation without saving the setting again", async () => {
    m.state.settings.rdfHandling = "PAY_MYSELF";
    await confirmDecision("owner", "IN-37-RDF", "PAY_MYSELF");
    expect(m.log).toContain("record:CONFIRMED");
    expect(m.log).not.toContain("write:settings");
  });
});

describe("professional answers", () => {
  it("sends a question to a professional and refuses other audiences", async () => {
    await sendToProfessional("owner", "IN-84", "ATTORNEY");
    expect(m.state.records[0]).toMatchObject({ kind: "SENT_TO_PROFESSIONAL", audience: "ATTORNEY" });
    await expect(sendToProfessional("owner", "IN-84", "OWNER")).rejects.toThrow(/CPA, attorney or translator/);
  });

  it("keeps an 'Other' answer as evidence only, never as a setting", async () => {
    await sendToProfessional("owner", "IN-37-RDF-OWED", "CPA");
    await recordProfessionalAnswer("owner", "IN-37-RDF-OWED", {
      value: null, otherText: "Depends on next year's sales", effectiveFrom: null,
      professionalName: "Pat Example", answeredOn: TODAY,
    }, "SCREEN");
    expect(m.state.records[0]).toMatchObject({ kind: "PROFESSIONAL_ANSWER", audience: "CPA",
      professionalName: "Pat Example" });
    expect(String(m.state.records[0]!.explanation)).toContain("Other: Depends on next year's sales");
    expect(m.log).not.toContain("write:settings");
    expect(m.state.settings.retailDeliveryFeeDecision).toBe("UNDECIDED");
  });

  it("applies a chosen answer through the setting's save and needs who answered", async () => {
    await expect(recordProfessionalAnswer("owner", "IN-37-RDF-OWED", {
      value: "NOT_LIABLE", effectiveFrom: null, professionalName: " ", answeredOn: TODAY,
    }, "SCREEN")).rejects.toThrow("Enter who answered.");
    await recordProfessionalAnswer("owner", "IN-37-RDF-OWED", {
      value: "NOT_LIABLE", effectiveFrom: null, professionalName: "Pat Example", professionalFirm: "Example CPAs",
      answeredOn: TODAY, explanation: "No prior-year sales.",
    }, "SCREEN");
    expect(m.state.settings.retailDeliveryFeeDecision).toBe("NOT_LIABLE");
    expect(m.state.records[0]).toMatchObject({ kind: "PROFESSIONAL_ANSWER", value: "NOT_LIABLE",
      professionalFirm: "Example CPAs", via: "SCREEN" });
  });

  it("refuses an attachment that isn't a private file of this question", async () => {
    await expect(recordProfessionalAnswer("owner", "IN-71", {
      value: 7, effectiveFrom: null, professionalName: "Pat", answeredOn: TODAY,
      attachmentUrl: "https://example.com/form.pdf",
    }, "SCREEN")).rejects.toThrow(/storage/);
    expect(m.log).toEqual([]);
  });
});

describe("completed forms: preview, then apply exactly what was shown", () => {
  const answers = [
    { code: "DQ-IN-37-RDF-OWED", option: "The business doesn't owe Colorado's retail delivery fee", answeredBy: "Pat" },
    { code: "IN-37-RDF", option: null, otherText: "Ask again in July", answeredBy: "Pat" },
    { code: "IN-99-NOPE", option: "X", answeredBy: "Pat" },
    { code: "IN-71", option: 7, answeredBy: "Pat", effectiveFrom: dayAfter(TODAY, -2) },
  ];

  it("shows each answer's effect and refuses to apply anything different from the preview", async () => {
    const { preview, confirmToken } = await previewAnswers("owner", answers);
    expect(preview.map((row) => row.status)).toEqual(["CHANGE", "OTHER", "INVALID", "INVALID"]);
    expect(preview[0]).toMatchObject({ now: "Not decided yet", after: "The business doesn't owe Colorado's retail delivery fee" });
    expect(preview[3]!.reason).toMatch(/can't apply to the past/);
    expect(m.log.some((entry) => /^(write|record|schedule)/.test(entry))).toBe(false);

    await expect(applyAnswers("owner", [{ ...answers[0]!, option: "The business owes it" }, ...answers.slice(1)],
      confirmToken)).rejects.toThrow(/changed since the preview/);
    await expect(applyAnswers("someone-else", answers, confirmToken)).rejects.toThrow(/expired or isn't yours/);
    expect(m.state.settings.retailDeliveryFeeDecision).toBe("UNDECIDED");

    const result = await applyAnswers("owner", answers, confirmToken);
    expect(result).toMatchObject({ applied: 1, same: 0, other: 1, skipped: 2 });
    expect(m.state.settings.retailDeliveryFeeDecision).toBe("NOT_LIABLE");
    expect(m.state.records.filter((row) => row.kind === "PROFESSIONAL_ANSWER")).toHaveLength(2);
    expect(m.state.records.every((row) => row.via === "IMPORT")).toBe(true);
    // One preview applies once: the same token can't add the same evidence again.
    await expect(applyAnswers("owner", answers, confirmToken)).rejects.toThrow(/already applied/);
    expect(m.state.records.filter((row) => row.kind === "PROFESSIONAL_ANSWER")).toHaveLength(2);
  });

  it("binds the attached form to the preview and keeps it with the previewed questions", async () => {
    const original = { store: process.env.PRIVATE_PHOTO_BLOB_STORE_ID, token: process.env.PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN };
    process.env.PRIVATE_PHOTO_BLOB_STORE_ID = "store_AbC123";
    process.env.PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN = ["vercel", "blob", "rw", "AbC123", "testonly"].join("_");
    try {
      const host = "https://abc123.private.blob.vercel-storage.com";
      const form = `${host}/decisions/IN-37-RDF-OWED/form.docx`;
      await expect(previewAnswers("owner", answers.slice(0, 1), { attachmentUrl: `${host}/decisions/IN-44/form.docx` }))
        .rejects.toThrow(/this question/);
      const { confirmToken } = await previewAnswers("owner", answers.slice(0, 1), { attachmentUrl: form });
      await expect(applyAnswers("owner", answers.slice(0, 1), confirmToken)).rejects.toThrow(/changed since the preview/);
      await expect(applyAnswers("owner", answers.slice(0, 1), confirmToken,
        { attachmentUrl: `${host}/decisions/IN-37-RDF-OWED/other.docx` })).rejects.toThrow(/changed since the preview/);
      await applyAnswers("owner", answers.slice(0, 1), confirmToken, { attachmentUrl: form });
      expect(m.state.records[0]).toMatchObject({ kind: "PROFESSIONAL_ANSWER", attachmentUrl: form });
    } finally {
      if (original.store === undefined) delete process.env.PRIVATE_PHOTO_BLOB_STORE_ID;
      else process.env.PRIVATE_PHOTO_BLOB_STORE_ID = original.store;
      if (original.token === undefined) delete process.env.PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN;
      else process.env.PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN = original.token;
    }
  });

  it("refuses the apply when a setting changed after the preview", async () => {
    const { confirmToken } = await previewAnswers("owner", answers.slice(0, 1));
    m.state.settings.retailDeliveryFeeDecision = "COLLECT";
    await expect(applyAnswers("owner", answers.slice(0, 1), confirmToken)).rejects.toThrow(/changed since the preview/);
  });

  it("flags two answers to one question", async () => {
    const { preview } = await previewAnswers("owner", [answers[0]!, { ...answers[0]!, option: "The business owes it" }]);
    expect(preview.map((row) => row.status)).toEqual(["INVALID", "INVALID"]);
  });
});
