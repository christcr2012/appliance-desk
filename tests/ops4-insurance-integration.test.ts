import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { archivePolicy, keepCertificateOnRecord, requestCertificate, savePolicy, saveReminderDays, saveWorkersComp } from "@/domains/insurance/actions";
import { renewRecord } from "@/domains/paperwork/records";
import { loadInsuranceOverview } from "@/domains/insurance/reads";
import { listInsuranceAttention } from "@/domains/exceptions/insurance-attention";

// OPS-4 on real Postgres.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";
const key = (offsetDays: number) => businessDateKey(new Date(Date.now() + offsetDays * 86_400_000));

describe.skipIf(!enabled)("insurance (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 8);
  const staffId = `ops4-staff-${tag}`;
  let ownerId = "";
  const policies: string[] = [];
  let before: { insuranceRemindFirstDays: number; insuranceRemindSecondDays: number; workersCompStatus: "NOT_SET" | "NO_EMPLOYEES_REJECTED" | "POLICY_IN_PLACE"; workersCompEmployees: number } | null = null;

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.user.create({ data: { id: staffId, email: `${staffId}@example.test`, role: "STAFF", emailVerified: true } });
    before = await prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {}, select: { insuranceRemindFirstDays: true, insuranceRemindSecondDays: true, workersCompStatus: true, workersCompEmployees: true } });
  });

  afterAll(async () => {
    const linked = await prisma.ownerInsurancePolicy.findMany({ where: { id: { in: policies }, recordId: { not: null } }, select: { recordId: true } });
    await prisma.insuranceCertificateRequest.deleteMany({ where: { policyId: { in: policies } } });
    await prisma.ownerInsurancePolicy.deleteMany({ where: { id: { in: policies } } });
    await prisma.businessPaperwork.deleteMany({ where: { id: { in: linked.map((l) => l.recordId!) } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: staffId }, { entityId: { in: policies } }, { action: { startsWith: "settings.insurance" }, userId: ownerId }, { action: "settings.workers_comp", userId: ownerId }] } });
    if (before) await prisma.businessSettings.update({ where: { id: "singleton" }, data: { ...before, workersCompNote: null, workersCompFormSentOn: null, workersCompMailNumber: null } });
    await prisma.user.deleteMany({ where: { id: staffId } });
  });

  const base = { kind: "GENERAL_LIABILITY" as const, insurer: "Acme Mutual", policyNumber: "GL-OPS4", agentEmail: "agent@ins.example" };

  it("adds, edits and archives a policy; staff cannot", async () => {
    await expect(savePolicy(staffId, null, { ...base, expiresOnKey: key(200) })).rejects.toThrow();
    const id = await savePolicy(ownerId, null, { ...base, expiresOnKey: key(200), annualPremiumCents: 123_400 });
    policies.push(id);
    await savePolicy(ownerId, id, { ...base, insurer: "Beta Mutual", expiresOnKey: key(220), annualPremiumCents: 130_000 });
    const row = await prisma.ownerInsurancePolicy.findUniqueOrThrow({ where: { id } });
    expect(row.insurer).toBe("Beta Mutual");
    expect(row.annualPremiumCents).toBe(130_000);
    await expect(savePolicy(ownerId, "missing", { ...base, expiresOnKey: key(200) })).rejects.toThrow(/find/);
    await archivePolicy(ownerId, id, true);
    expect((await prisma.ownerInsurancePolicy.findUniqueOrThrow({ where: { id } })).archivedAt).not.toBeNull();
    await archivePolicy(ownerId, id, false);
  });

  it("puts a policy on the owner's To do at the first and second reminder and when it has ended, but not before", async () => {
    await saveReminderDays(ownerId, 60, 30);
    const far = await savePolicy(ownerId, null, { ...base, policyNumber: "FAR-OPS4", expiresOnKey: key(120) });
    const first = await savePolicy(ownerId, null, { ...base, kind: "COMMERCIAL_AUTO", policyNumber: "FIRST-OPS4", expiresOnKey: key(50) });
    const second = await savePolicy(ownerId, null, { ...base, kind: "EQUIPMENT", policyNumber: "SECOND-OPS4", expiresOnKey: key(10) });
    const ended = await savePolicy(ownerId, null, { ...base, kind: "OTHER", policyNumber: "ENDED-OPS4", expiresOnKey: key(-3) });
    policies.push(far, first, second, ended);
    const rows = await listInsuranceAttention(new Date());
    const mine = (num: string) => rows.find((r) => r.detail.includes(`policy ${num}.`));
    expect(mine("FAR-OPS4")).toBeUndefined();
    expect(mine("FIRST-OPS4")?.severity).toBe("medium");
    expect(mine("SECOND-OPS4")?.severity).toBe("high");
    expect(mine("ENDED-OPS4")?.title).toMatch(/ended 3 days ago/);
    // An archived policy is no longer chased.
    await archivePolicy(ownerId, ended, true);
    expect((await listInsuranceAttention(new Date())).find((r) => r.detail.includes("policy ENDED-OPS4."))).toBeUndefined();
  });

  it("uses the owner's own reminder days, and refuses nonsense", async () => {
    await expect(saveReminderDays(staffId, 60, 30)).rejects.toThrow();
    await expect(saveReminderDays(ownerId, 20, 30)).rejects.toThrow(/earlier/);
    await saveReminderDays(ownerId, 90, 45);
    const id = await savePolicy(ownerId, null, { ...base, policyNumber: "NINETY-OPS4", expiresOnKey: key(80) });
    policies.push(id);
    expect((await listInsuranceAttention(new Date())).some((r) => r.detail.includes("policy NINETY-OPS4."))).toBe(true);
    await saveReminderDays(ownerId, 60, 30);
    expect((await listInsuranceAttention(new Date())).some((r) => r.detail.includes("policy NINETY-OPS4."))).toBe(false);
  });

  it("raises 'workers' compensation is required now' only with employees and no live policy", async () => {
    await saveWorkersComp(ownerId, { status: "NO_EMPLOYEES_REJECTED", employees: 0, formSentOnKey: key(-5), mailNumber: "7019 0001" });
    expect((await listInsuranceAttention(new Date())).some((r) => /Workers' compensation insurance is required now/.test(r.title))).toBe(false);
    await expect(saveWorkersComp(ownerId, { status: "NO_EMPLOYEES_REJECTED", employees: 1 })).rejects.toThrow(/employees/);
    await expect(saveWorkersComp(staffId, { status: "NOT_SET", employees: 0 })).rejects.toThrow();
    await saveWorkersComp(ownerId, { status: "NOT_SET", employees: 1 });
    const need = (await listInsuranceAttention(new Date())).find((r) => /Workers' compensation insurance is required now/.test(r.title));
    expect(need?.severity).toBe("high");
    const wc = await savePolicy(ownerId, null, { ...base, kind: "WORKERS_COMP", policyNumber: "WC-OPS4", expiresOnKey: key(300) });
    policies.push(wc);
    await saveWorkersComp(ownerId, { status: "POLICY_IN_PLACE", employees: 1, note: "Test policy" });
    expect((await loadInsuranceOverview(new Date())).workersCompRequired).toBe(false);
    await archivePolicy(ownerId, wc, true); // no live policy any more
    expect((await loadInsuranceOverview(new Date())).workersCompRequired).toBe(true);
    // A policy that starts in the future does not cover today.
    const future = await savePolicy(ownerId, null, { ...base, kind: "WORKERS_COMP", policyNumber: "WC-FUTURE-OPS4", effectiveOnKey: key(30), expiresOnKey: key(400) });
    policies.push(future);
    expect((await loadInsuranceOverview(new Date())).workersCompRequired).toBe(true);
  });

  it("gives each reminder a steady identity per policy and stage, so a snooze lasts", async () => {
    await saveReminderDays(ownerId, 60, 30);
    const id = await savePolicy(ownerId, null, { ...base, kind: "OTHER", policyNumber: "KEY-OPS4", expiresOnKey: key(50) });
    policies.push(id);
    const today = (await listInsuranceAttention(new Date())).find((r) => r.detail.includes("policy KEY-OPS4."));
    const tomorrow = (await listInsuranceAttention(new Date(Date.now() + 86_400_000))).find((r) => r.detail.includes("policy KEY-OPS4."));
    expect(today?.title).not.toBe(tomorrow?.title);
    expect(today?.todoKey).toBe(`insurance-renewal:${id}:first`);
    expect(tomorrow?.todoKey).toBe(today?.todoKey);
  });

  it("records a certificate request and returns an email draft without sending anything", async () => {
    const withAgent = await savePolicy(ownerId, null, { ...base, policyNumber: "COI-OPS4", expiresOnKey: key(300) });
    const noAgent = await savePolicy(ownerId, null, { ...base, policyNumber: "NOAGENT-OPS4", agentEmail: undefined, expiresOnKey: key(300) });
    policies.push(withAgent, noAgent);
    await expect(requestCertificate(ownerId, noAgent, { requesterName: "Pat", requesterEmail: "pat@pm.example" })).rejects.toThrow(/agent's email/);
    await expect(requestCertificate(ownerId, withAgent, { requesterName: "", requesterEmail: "pat@pm.example" })).rejects.toThrow();
    await expect(requestCertificate(staffId, withAgent, { requesterName: "Pat", requesterEmail: "pat@pm.example" })).rejects.toThrow();
    const draft = await requestCertificate(ownerId, withAgent, { requesterName: "Pat Lee", requesterCompany: "Front Range PM", requesterEmail: "pat@pm.example", holderText: "Front Range PM" });
    expect(draft.to).toBe("agent@ins.example");
    expect(draft.body).toContain("Pat Lee");
    expect(await prisma.insuranceCertificateRequest.count({ where: { policyId: withAgent } })).toBe(1);
  });
  it("keeps the certificate on one business record: owner only, once, and renewals carry across", async () => {
    const id = await savePolicy(ownerId, null, { ...base, policyNumber: "CERT-OPS4", expiresOnKey: key(300), annualPremiumCents: 240_000 });
    policies.push(id);
    await expect(keepCertificateOnRecord(staffId, id)).rejects.toThrow();
    const admin = `ops4-admin-${tag}`;
    await prisma.user.create({ data: { id: admin, email: `${admin}@example.test`, role: "ADMIN", emailVerified: true } });
    try {
      await expect(keepCertificateOnRecord(admin, id)).rejects.toThrow();
    } finally {
      await prisma.user.deleteMany({ where: { id: admin } });
    }
    await expect(keepCertificateOnRecord(ownerId, "missing")).rejects.toThrow(/find/);
    const results = await Promise.all([keepCertificateOnRecord(ownerId, id), keepCertificateOnRecord(ownerId, id)]);
    expect(results[0].recordId).toBe(results[1].recordId);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const record = await prisma.businessPaperwork.findUniqueOrThrow({ where: { id: results[0].recordId } });
    expect(record.kind).toBe("INSURANCE");
    expect(record.costCents).toBe(240_000);
    expect(await prisma.businessPaperwork.count({ where: { id: results[0].recordId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "insurance.certificate_record_created", entityId: id } })).toBe(1);
    // Renewing the policy updates the same record instead of leaving a stale copy.
    await savePolicy(ownerId, id, { ...base, policyNumber: "CERT-OPS4", expiresOnKey: key(500), annualPremiumCents: 260_000 });
    const renewed = await prisma.businessPaperwork.findUniqueOrThrow({ where: { id: results[0].recordId } });
    expect(renewed.costCents).toBe(260_000);
    expect(renewed.id).toBe(record.id);
    expect(renewed.expiresOn?.getTime()).not.toBe(record.expiresOn?.getTime());
    // The owner's own reminder setting on the record survives a policy save...
    await prisma.businessPaperwork.update({ where: { id: record.id }, data: { remindDaysBefore: 45 } });
    await savePolicy(ownerId, id, { ...base, policyNumber: "CERT-OPS4", agentName: "New Agent", expiresOnKey: key(500), annualPremiumCents: 260_000 });
    expect((await prisma.businessPaperwork.findUniqueOrThrow({ where: { id: record.id } })).remindDaysBefore).toBe(45);
    // ...and renewing through the record carries the new end date back onto the policy.
    const current = await prisma.businessPaperwork.findUniqueOrThrow({ where: { id: record.id } });
    await renewRecord(ownerId, record.id, { expiresOn: key(700), expectedVersion: current.version });
    const policy = await prisma.ownerInsurancePolicy.findUniqueOrThrow({ where: { id } });
    expect(businessDateKey(policy.expiresOn)).toBe(key(700));
  });
});
