import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
  approveFiling,
  listComplianceFilings,
  prepareFiling,
  submitFiling,
  syncComplianceFilings,
} from "@/domains/compliance/filings";
import { getComplianceProfile, saveBusinessFacts } from "@/domains/compliance/profile";

// Disposable CI Postgres only (same gate as the other integration tests).
const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  url !== null &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("compliance filings", () => {
  const tag = randomUUID();
  let ownerId: string;
  const filingIds: string[] = [];
  let preparedFilingId = "";

  beforeAll(async () => {
    process.env.COMPLIANCE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.complianceFiling.deleteMany({});
    await prisma.complianceProfile.deleteMany({});
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...filingIds, "singleton"] } } });
    await prisma.complianceFiling.deleteMany({ where: { id: { in: filingIds } } });
    await prisma.complianceProfile.deleteMany({});
    delete process.env.COMPLIANCE_ENCRYPTION_KEY;
  });

  it("sync creates rows for applying obligations only, and is idempotent", async () => {
    const first = await syncComplianceFilings(new Date("2026-10-26T12:00:00Z"));
    expect(first.created).toBeGreaterThan(10);
    const rows = await listComplianceFilings();
    rows.forEach((r) => filingIds.push(r.id));
    const keys = new Set(rows.map((r) => r.obligationKey));
    expect(keys.has("fed.estimated_tax")).toBe(true);
    expect(keys.has("fed.income.schedule_c")).toBe(true);
    expect(keys.has("co.bpp.weld_declaration")).toBe(true); // 2027 assessment year is in range
    expect(keys.has("fed.payroll.941")).toBe(false); // dormant: no employees
    expect(keys.has("co.sos.periodic_report")).toBe(false); // no report month yet
    expect(keys.has("fed.usdot")).toBe(false); // no truck weight recorded

    const second = await syncComplianceFilings(new Date("2026-10-26T12:00:00Z"));
    expect(second.created).toBe(0);
  });

  it("business facts store the EIN encrypted, show only last 4, and never audit it", async () => {
    await saveBusinessFacts(ownerId, {
      entityType: "SINGLE_MEMBER_LLC",
      ein: "47-1234567",
      sosReportMonth: 5,
      truckGvwrLbs: 14000,
      employees: 0,
      hasHomeOffice: false,
    });
    const profile = await getComplianceProfile();
    expect(profile.einLast4).toBe("4567");
    expect(profile.einEncrypted).toBeTruthy();
    expect(profile.einEncrypted).not.toContain("471234567");
    expect(profile.einEncrypted!.startsWith("v1:")).toBe(true);

    const audits = await prisma.auditLog.findMany({ where: { entityId: "singleton" } });
    const blob = JSON.stringify(audits.map((a) => a.newValue));
    expect(blob).not.toContain("471234567");
    expect(blob).not.toContain("47-1234567");

    // And now the SOS report can be scheduled.
    const sync = await syncComplianceFilings(new Date("2026-10-26T12:00:00Z"));
    expect(sync.created).toBeGreaterThan(0);
    const rows = await listComplianceFilings();
    rows.forEach((r) => {
      if (!filingIds.includes(r.id)) filingIds.push(r.id);
    });
    expect(rows.some((r) => r.obligationKey === "co.sos.periodic_report")).toBe(true);
  });

  it("prepare binds a hash; approval refuses changed numbers; submit files once", async () => {
    const filing = (await listComplianceFilings()).find((r) => r.obligationKey === "fed.estimated_tax")!;
    await prepareFiling(ownerId, filing.id, { amountDueCents: 125000, basis: "Safe harbor, last year's tax" });
    let row = await prisma.complianceFiling.findUniqueOrThrow({ where: { id: filing.id } });
    expect(row.state).toBe("READY_FOR_REVIEW");
    expect(row.preparedHash).toMatch(/^[0-9a-f]{64}$/);

    await expect(approveFiling(ownerId, filing.id, "0".repeat(64))).rejects.toThrow(/Numbers changed/);
    await approveFiling(ownerId, filing.id, row.preparedHash!);
    row = await prisma.complianceFiling.findUniqueOrThrow({ where: { id: filing.id } });
    expect(row.state).toBe("APPROVED");
    expect(row.approvedByUserId).toBe(ownerId);

    // Two taps at the same moment: exactly one submission.
    const [a, b] = await Promise.all([
      submitFiling(ownerId, filing.id, "paid at Direct Pay"),
      submitFiling(ownerId, filing.id, "paid at Direct Pay"),
    ]);
    expect([a.alreadySubmitted, b.alreadySubmitted].sort()).toEqual([false, true]);
    row = await prisma.complianceFiling.findUniqueOrThrow({ where: { id: filing.id } });
    expect(row.state).toBe("SUBMITTED");
    expect(row.submittedAt).not.toBeNull();
  });

  it("prepared numbers refuse a full tax ID", async () => {
    const filing = (await listComplianceFilings()).find(
      (r) => r.obligationKey === "fed.1099_nec" && r.state === "UPCOMING",
    )!;
    await expect(
      prepareFiling(ownerId, filing.id, { payerEin: "47-1234567" }),
    ).rejects.toThrow(/full tax ID/);
    await expect(
      prepareFiling(ownerId, filing.id, { payerEin: "471234567" }),
    ).rejects.toThrow(/full tax ID/);
    // Last 4 is fine.
    await prepareFiling(ownerId, filing.id, { payerEinLast4: "4567" });
    preparedFilingId = filing.id;
    const row = await prisma.complianceFiling.findUniqueOrThrow({ where: { id: filing.id } });
    expect(row.state).toBe("READY_FOR_REVIEW");
  });

  it("sync never rewrites a filing already in motion", async () => {
    const before = await prisma.complianceFiling.findUniqueOrThrow({
      where: { id: preparedFilingId },
    });
    await syncComplianceFilings(new Date("2026-10-27T12:00:00Z"));
    const after = await prisma.complianceFiling.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.state).toBe("READY_FOR_REVIEW");
    expect(after.preparedHash).toBe(before.preparedHash);
    expect(tag).toBeTruthy();
  });

  it("two syncs at the same moment both succeed and create one set of rows", async () => {
    await prisma.complianceFiling.deleteMany({});
    const now = new Date("2026-10-26T12:00:00Z");
    const [a, b] = await Promise.all([syncComplianceFilings(now), syncComplianceFilings(now)]);
    // The settings-row lock serializes them: whichever runs second creates nothing.
    expect(Math.min(a.created, b.created)).toBe(0);
    const count = await prisma.complianceFiling.count();
    expect(count).toBe(a.created + b.created);
    expect(count).toBeGreaterThan(10);
  });
});
