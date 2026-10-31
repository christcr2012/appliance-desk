import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveDeductionLabels } from "@/domains/tax/setup";
import { parseDeductionLabels } from "@/domains/tax/deduction-labels";

/**
 * W-12 / IN-44 amendment (Chris, 2026-10-31): the deduction labels are
 * editable by the owner AND by the business's accountant (the CPA the
 * IN-44 question is addressed to), nobody else. Provenance follows the
 * editor, unchanged entries keep theirs, and every save is audit-logged
 * with per-bucket old and new values. Real Postgres; CI-gated like the
 * other tax integration suites.
 */
const urlText = process.env.DATABASE_URL ?? "";
let enabled = false;
try {
  const u = new URL(urlText);
  enabled = process.env.CI === "true" && u.pathname === "/appliance_desk_test" &&
    ["localhost", "127.0.0.1"].includes(u.hostname);
} catch { enabled = false; }

const tag = randomUUID().slice(0, 10);
const ids = {
  owner: "w12-owner-" + tag,
  accountant: "w12-acct-" + tag,
  expired: "w12-expired-" + tag,
  staff: "w12-staff-" + tag,
  account: "w12-filing-" + tag,
};
const email = (who: string) => `w12-${who}-${tag}@example.test`;

describe.skipIf(!enabled)("W-12 deduction labels: owner + accountant edit, provenance, audit", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ids.owner, name: "Owner", email: email("owner"), role: "OWNER", emailVerified: true },
        { id: ids.accountant, name: "Accountant", email: email("acct"), role: "ACCOUNTANT", emailVerified: true },
        {
          id: ids.expired, name: "Expired accountant", email: email("expired"), role: "ACCOUNTANT",
          emailVerified: true, accessEndsOn: new Date("2026-01-01T00:00:00Z"),
        },
        { id: ids.staff, name: "Staff", email: email("staff"), role: "STAFF", emailVerified: true },
      ],
    });
    await prisma.taxFilingAccount.create({
      data: { id: ids.account, name: "W12 labels " + tag, kind: "SALES_RETURN", basis: "ACCRUAL" },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: ids.account } });
    await prisma.taxFilingAccount.delete({ where: { id: ids.account } });
    await prisma.user.deleteMany({
      where: { id: { in: [ids.owner, ids.accountant, ids.expired, ids.staff] } },
    });
  });

  const fresh = async () => prisma.taxFilingAccount.findUniqueOrThrow({
    where: { id: ids.account }, select: { updatedAt: true, deductionLabels: true },
  });

  it("stamps provenance by editor and preserves it for unchanged entries", async () => {
    // Owner saves custom wording for one bucket → OWNER.
    let account = await fresh();
    await saveDeductionLabels(ids.owner, ids.account, {
      NOT_TAXED_CATEGORY: { label: "Owner wording", reportAs: "DEDUCTION" },
    }, account.updatedAt);
    account = await fresh();
    expect(parseDeductionLabels(account.deductionLabels).NOT_TAXED_CATEGORY).toEqual({
      label: "Owner wording", reportAs: "DEDUCTION", source: "OWNER",
    });

    // Accountant confirms that bucket as-is and sets another → the
    // unchanged bucket keeps OWNER; the changed one becomes ACCOUNTANT.
    await saveDeductionLabels(ids.accountant, ids.account, {
      NOT_TAXED_CATEGORY: { label: "Owner wording", reportAs: "DEDUCTION" },
      OUTSIDE_AREA: { label: "CPA outside wording", reportAs: "DEDUCTION" },
    }, account.updatedAt);
    account = await fresh();
    const labels = parseDeductionLabels(account.deductionLabels);
    expect(labels.NOT_TAXED_CATEGORY!.source).toBe("OWNER");
    expect(labels.OUTSIDE_AREA).toEqual({
      label: "CPA outside wording", reportAs: "DEDUCTION", source: "ACCOUNTANT",
    });

    // Owner re-saves everything untouched → accountant provenance survives.
    await saveDeductionLabels(ids.owner, ids.account, {
      NOT_TAXED_CATEGORY: { label: "Owner wording", reportAs: "DEDUCTION" },
      OUTSIDE_AREA: { label: "CPA outside wording", reportAs: "DEDUCTION" },
    }, account.updatedAt);
    account = await fresh();
    expect(parseDeductionLabels(account.deductionLabels).OUTSIDE_AREA!.source).toBe("ACCOUNTANT");
  });

  it("audit-logs each save with the actor role and per-bucket old and new", async () => {
    const rows = await prisma.auditLog.findMany({
      where: { entityId: ids.account, action: "tax.setup.deduction_labels_saved" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const accountantSave = rows.find(r => r.userId === ids.accountant);
    expect(accountantSave).toBeDefined();
    const newValue = accountantSave!.newValue as {
      actorRole?: string;
      deductionLabels?: Record<string, { source?: string }>;
    };
    expect(newValue.actorRole).toBe("ACCOUNTANT");
    expect(newValue.deductionLabels?.OUTSIDE_AREA?.source).toBe("ACCOUNTANT");
    const oldValue = accountantSave!.oldValue as {
      deductionLabels?: Record<string, { label?: string }>;
    };
    expect(oldValue.deductionLabels?.NOT_TAXED_CATEGORY?.label).toBe("Owner wording");
    expect(oldValue.deductionLabels?.OUTSIDE_AREA).toBeUndefined();
  });

  it("refuses staff, an expired accountant, and a stale version", async () => {
    const account = await fresh();
    await expect(saveDeductionLabels(ids.staff, ids.account, {
      NOT_TAXED_CATEGORY: { label: "Staff wording", reportAs: "DEDUCTION" },
    }, account.updatedAt)).rejects.toThrow();
    await expect(saveDeductionLabels(ids.expired, ids.account, {
      NOT_TAXED_CATEGORY: { label: "Expired wording", reportAs: "DEDUCTION" },
    }, account.updatedAt)).rejects.toThrow();
    await expect(saveDeductionLabels(ids.owner, ids.account, {
      NOT_TAXED_CATEGORY: { label: "Stale wording", reportAs: "DEDUCTION" },
    }, new Date("2000-01-01T00:00:00Z"))).rejects.toThrow(/changed in another session/);
    // None of the refused saves landed.
    const after = await fresh();
    expect(parseDeductionLabels(after.deductionLabels).NOT_TAXED_CATEGORY!.label)
      .toBe("Owner wording");
  });
});
