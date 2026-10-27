import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
  approveFiling,
  listComplianceFilings,
  markFilingNotApplicable,
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

  it("sync retires pending filings when corrected facts stop an obligation applying", async () => {
    // Hire (in the facts), sync, and payroll rows appear.
    await saveBusinessFacts(ownerId, {
      entityType: "SINGLE_MEMBER_LLC",
      ein: undefined,
      sosReportMonth: 5,
      truckGvwrLbs: 14000,
      employees: 1,
      hasHomeOffice: false,
    });
    await syncComplianceFilings(new Date("2026-10-26T12:00:00Z"));
    const payroll = await prisma.complianceFiling.findMany({
      where: { obligationKey: "fed.payroll.941", state: "UPCOMING" },
    });
    payroll.forEach((r) => {
      if (!filingIds.includes(r.id)) filingIds.push(r.id);
    });
    expect(payroll.length).toBeGreaterThan(0);
    // One payroll filing is already in motion — history the sync must keep.
    const inMotion = payroll[0]!;
    await prisma.complianceFiling.update({ where: { id: inMotion.id }, data: { state: "APPROVED" } });

    // The correction: no employees after all. Pending payroll reminders end.
    await saveBusinessFacts(ownerId, {
      entityType: "SINGLE_MEMBER_LLC",
      ein: undefined,
      sosReportMonth: 5,
      truckGvwrLbs: 14000,
      employees: 0,
      hasHomeOffice: false,
    });
    const result = await syncComplianceFilings(new Date("2026-10-26T12:00:00Z"));
    expect(result.retired).toBeGreaterThan(0);
    const after = await prisma.complianceFiling.findMany({ where: { obligationKey: "fed.payroll.941" } });
    expect(after.filter((r) => r.state === "UPCOMING")).toHaveLength(0);
    expect(after.find((r) => r.id === inMotion.id)!.state).toBe("APPROVED");
    expect(after.some((r) => r.state === "NOT_APPLICABLE")).toBe(true);
  });

  it("auto-retired filings reactivate when the facts return; an owner's not-needed decision never does", async () => {
    const facts = (employees: number) =>
      saveBusinessFacts(ownerId, {
        entityType: "SINGLE_MEMBER_LLC",
        ein: undefined,
        sosReportMonth: 5,
        truckGvwrLbs: 14000,
        employees,
        hasHomeOffice: false,
      });
    const now = new Date("2026-10-26T12:00:00Z");

    await facts(1);
    await syncComplianceFilings(now);
    const active = await prisma.complianceFiling.findMany({
      where: { obligationKey: "fed.payroll.941", state: "UPCOMING" },
    });
    active.forEach((r) => {
      if (!filingIds.includes(r.id)) filingIds.push(r.id);
    });
    expect(active.length).toBeGreaterThan(0);

    // The owner marks one period not needed — their decision, recorded.
    const decided = active[0]!;
    await markFilingNotApplicable(ownerId, decided.id, "Filed with the January return instead.");
    // Another period is prepared, so it is in motion when the facts change.
    const prepared = active[1]!;
    await prepareFiling(ownerId, prepared.id, { wagesCents: 420000 });

    await facts(0);
    const retiredSync = await syncComplianceFilings(now);
    expect(retiredSync.retired).toBeGreaterThan(0);
    const whileAway = await prisma.complianceFiling.findMany({ where: { obligationKey: "fed.payroll.941" } });
    // Everything untouched-pending retired automatically...
    expect(whileAway.filter((r) => r.state === "UPCOMING")).toHaveLength(0);
    expect(whileAway.some((r) => r.autoRetired)).toBe(true);
    // ...the prepared one was locked and rechecked, not overwritten...
    expect(whileAway.find((r) => r.id === prepared.id)!.state).toBe("READY_FOR_REVIEW");
    // ...and the owner's decision stands apart from the automatic ones.
    const decidedRow = whileAway.find((r) => r.id === decided.id)!;
    expect(decidedRow.state).toBe("NOT_APPLICABLE");
    expect(decidedRow.autoRetired).toBe(false);

    await facts(1);
    const backSync = await syncComplianceFilings(now);
    expect(backSync.reactivated).toBeGreaterThan(0);
    const back = await prisma.complianceFiling.findMany({ where: { obligationKey: "fed.payroll.941" } });
    expect(back.filter((r) => r.state === "UPCOMING").length).toBe(active.length - 2);
    expect(back.find((r) => r.id === decided.id)!.state).toBe("NOT_APPLICABLE");
    expect(back.find((r) => r.id === prepared.id)!.state).toBe("READY_FOR_REVIEW");
    await facts(0);
    await syncComplianceFilings(now);
  });

  it("business facts saves wait for the profile row lock before reading their baseline", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ComplianceProfile" WHERE "id" = 'singleton' FOR UPDATE`;
        await gate;
      },
      { timeout: 20000, maxWait: 20000 },
    );
    let settled = false;
    const save = saveBusinessFacts(ownerId, {
      entityType: "SINGLE_MEMBER_LLC",
      ein: undefined,
      sosReportMonth: 5,
      truckGvwrLbs: 14000,
      employees: 0,
      hasHomeOffice: false,
    }).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(settled).toBe(false);
    release();
    await Promise.all([holder, save]);
    expect(settled).toBe(true);
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
