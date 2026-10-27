import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// SETUP-1 on real disposable Postgres: owner-only writes, audit-folded
// progress, checks that tell the truth (record number/file, filing account,
// env presence), step saves landing on the VAULT-1 records, and the To do.
const m = vi.hoisted(() => ({
  blobs: new Map<string, Uint8Array>(),
  store: { token: "test-token", storeId: "store_test" } as { token: string; storeId: string } | null,
}));
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: Buffer | Uint8Array) => {
    m.blobs.set(pathname, new Uint8Array(body as Uint8Array));
    return { url: `https://store.example/${pathname}`, pathname };
  },
  get: async (pathname: string) => {
    const bytes = m.blobs.get(pathname);
    if (!bytes) return { statusCode: 404, stream: null, blob: { contentType: "", size: 0 } };
    return {
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      blob: { contentType: "application/pdf", size: bytes.length },
    };
  },
  del: async () => undefined,
  list: async () => ({ blobs: [], hasMore: false }),
}));
vi.mock("@/lib/photo-storage", async (original) => ({
  ...(await original<typeof import("@/lib/photo-storage")>()),
  getPrivatePhotoStore: () => m.store,
}));

import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/field-crypto";
import {
  dismissWalkthrough,
  getSetupGuideState,
  markStepDone,
  reopenStep,
  restoreWalkthrough,
} from "@/domains/setup/guide";
import { saveStepFile, saveStepNumber } from "@/domains/setup/step-saves";
import { listSetupGuideAttention } from "@/domains/exceptions/setup-attention";
import { ensureStarterRecord, markPaperworkDone } from "@/domains/paperwork";
import { getRecord } from "@/domains/paperwork/records";

let enabled = false;
try {
  const target = new URL(process.env.DATABASE_URL ?? "");
  enabled =
    process.env.CI === "true" &&
    !process.env.VERCEL &&
    ["localhost", "127.0.0.1"].includes(target.hostname) &&
    target.pathname === "/appliance_desk_test";
} catch {
  enabled = false;
}

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nsetup test document\n");
const JUNE = new Date("2026-06-15T12:00:00Z");

describe.skipIf(!enabled)("SETUP-1 setup guide (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const ownerId = `setup-owner-${tag}`;
  const staffId = `setup-staff-${tag}`;
  let filingAccountId: string | null = null;

  const stepState = async (walkthroughKey: string, stepKey: string, env?: NodeJS.ProcessEnv) => {
    const state = await getSetupGuideState(JUNE, env);
    return state.walkthroughs.find((w) => w.key === walkthroughKey)?.steps.find((s) => s.key === stepKey);
  };

  beforeAll(async () => {
    process.env.COMPLIANCE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${ownerId}@example.test`, name: "Owner", role: "OWNER" },
        { id: staffId, email: `${staffId}@example.test`, name: "Staff", role: "STAFF" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "SetupGuide" } });
    if (filingAccountId) await prisma.taxFilingAccount.delete({ where: { id: filingAccountId } });
    const records = await prisma.businessPaperwork.findMany({
      where: { templateKey: { not: null } },
      select: { id: true },
    });
    const ids = records.map((r) => r.id);
    await prisma.businessRecordFile.deleteMany({ where: { recordId: { in: ids } } });
    await prisma.businessPaperwork.deleteMany({ where: { id: { in: ids } } });
    // The test users stay (synthetic ids, like the VAULT-1 suite leaves): audit
    // rows and record authorship point at them.
    delete process.env.COMPLIANCE_ENCRYPTION_KEY;
  });

  it("refuses writes from anyone but the owner, and unknown keys", async () => {
    await expect(markStepDone(staffId, "ein", "apply-ein")).rejects.toThrow();
    await expect(markStepDone(ownerId, "no-such", "apply-ein")).rejects.toThrow(/doesn't exist/);
    await expect(markStepDone(ownerId, "ein", "no-such-step")).rejects.toThrow(/doesn't exist/);
    await expect(saveStepNumber(ownerId, "ein", "save-ein-letter", "12-3456789")).rejects.toThrow(
      /doesn't take a number/,
    );
  });

  it("folds progress from the audit rows: done, reopened, dismissed, restored", async () => {
    expect((await stepState("business-basics", "trade-name"))?.done).toBe(false);
    await markStepDone(ownerId, "business-basics", "trade-name");
    let step = await stepState("business-basics", "trade-name");
    expect(step?.markedDone).toBe(true);
    expect(step?.done).toBe(true);
    await reopenStep(ownerId, "business-basics", "trade-name");
    step = await stepState("business-basics", "trade-name");
    expect(step?.done).toBe(false);

    const before = await getSetupGuideState(JUNE);
    expect(before.suggestedKey).toBe("business-basics");
    await dismissWalkthrough(ownerId, "business-basics");
    const dismissedState = await getSetupGuideState(JUNE);
    expect(dismissedState.walkthroughs.find((w) => w.key === "business-basics")?.dismissed).toBe(true);
    expect(dismissedState.suggestedKey).toBe("ein");
    await restoreWalkthrough(ownerId, "business-basics");
    expect((await getSetupGuideState(JUNE)).suggestedKey).toBe("business-basics");
  });

  it("saves a step's number onto the record, encrypted, and the check then passes", async () => {
    expect((await stepState("ein", "apply-ein"))?.checked).toBe(false);
    await saveStepNumber(ownerId, "ein", "apply-ein", "12-3456789");
    const row = await prisma.businessPaperwork.findUniqueOrThrow({ where: { templateKey: "ein" } });
    expect(row.numberEncrypted).not.toBeNull();
    expect(row.numberEncrypted).not.toContain("12-3456789");
    expect(decryptField(row.numberEncrypted!)).toBe("12-3456789");
    expect(row.numberLast4).toBe("6789");
    const step = await stepState("ein", "apply-ein");
    expect(step?.checked).toBe(true);
    expect(step?.done).toBe(true);
    expect(step?.hasNumber).toBe(true);
    expect((await getRecord("OWNER", row.id))?.numberLast4).toBe("6789");
  });

  it("attaches a step's file to its record, and the check then passes", async () => {
    expect((await stepState("business-basics", "operating-agreement"))?.checked).toBe(false);
    await saveStepFile(ownerId, "business-basics", "operating-agreement", {
      fileName: "agreement.pdf",
      bytes: PDF_BYTES,
    });
    const step = await stepState("business-basics", "operating-agreement");
    expect(step?.checked).toBe(true);
    expect(step?.fileCount).toBe(1);
  });

  it("does not check a record step for a record that merely exists", async () => {
    // The starter checklist creates every record empty; existence is not
    // evidence. The step checks only once the record itself is marked done.
    await ensureStarterRecord(ownerId, "llc");
    expect((await stepState("business-basics", "form-llc"))?.checked).toBe(false);
    const row = await prisma.businessPaperwork.findUniqueOrThrow({ where: { templateKey: "llc" } });
    await markPaperworkDone(ownerId, row.id, row.version, JUNE);
    expect((await stepState("business-basics", "form-llc"))?.checked).toBe(true);
  });

  it("sees the filing account once one is set up", async () => {
    expect((await stepState("colorado-sales-tax", "filing-account"))?.checked).toBe(false);
    const account = await prisma.taxFilingAccount.create({
      data: { name: `Setup test ${tag}`, kind: "SALES_RETURN" },
    });
    filingAccountId = account.id;
    expect((await stepState("colorado-sales-tax", "filing-account"))?.checked).toBe(true);
  });

  it("checks key presence only, from the env it is given", async () => {
    const emptyEnv: NodeJS.ProcessEnv = {
      ...process.env,
      COMPLIANCE_ENCRYPTION_KEY: undefined,
      VAULT_ENCRYPTION_KEY: undefined,
    };
    const keyEnv: NodeJS.ProcessEnv = {
      ...process.env,
      COMPLIANCE_ENCRYPTION_KEY: "present-but-never-shown",
      VAULT_ENCRYPTION_KEY: undefined,
    };
    const bare = await stepState("encryption-keys", "compliance-key", emptyEnv);
    expect(bare?.checked).toBe(false);
    const withKey = await stepState("encryption-keys", "compliance-key", keyEnv);
    expect(withKey?.checked).toBe(true);
    const vault = await stepState("encryption-keys", "vault-key", keyEnv);
    expect(vault?.checked).toBe(false);

    // Private storage is the PRIVATE store's pair of settings — the public
    // photo token must not satisfy it, and both settings are required.
    const noPrivate: NodeJS.ProcessEnv = {
      ...process.env,
      BLOB_READ_WRITE_TOKEN: "public-token-does-not-count",
      PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN: undefined,
      PRIVATE_PHOTO_BLOB_STORE_ID: undefined,
    };
    expect((await stepState("backups", "private-storage", noPrivate))?.checked).toBe(false);
    const tokenOnly: NodeJS.ProcessEnv = {
      ...noPrivate,
      PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN: "present-but-never-shown",
    };
    expect((await stepState("backups", "private-storage", tokenOnly))?.checked).toBe(false);
    const bothPrivate: NodeJS.ProcessEnv = { ...tokenOnly, PRIVATE_PHOTO_BLOB_STORE_ID: "store_present" };
    expect((await stepState("backups", "private-storage", bothPrivate))?.checked).toBe(true);
  });

  it("raises one To do naming the suggested walkthrough, and clears when all are done or dismissed", async () => {
    const items = await listSetupGuideAttention(JUNE);
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("SETUP_GUIDE");
    expect(items[0].title).toContain("Business basics");
    expect(items[0].href).toBe("/desk/setup-guide/business-basics");

    const { WALKTHROUGHS } = await import("@/domains/setup/walkthroughs");
    for (const w of WALKTHROUGHS) await dismissWalkthrough(ownerId, w.key);
    try {
      expect(await listSetupGuideAttention(JUNE)).toEqual([]);
      expect((await getSetupGuideState(JUNE)).suggestedKey).toBeNull();
    } finally {
      for (const w of WALKTHROUGHS) await restoreWalkthrough(ownerId, w.key);
    }
  });
});
