import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TelecomSmsProvider } from "@/lib/communications/providers/types";
import { getWorkflowTextPreview, recordStaffTextConsent, sendWorkflowText } from "@/domains/messaging/workflow-text";
import { approveWorkflowWording, setWorkflowTextEnabled } from "@/domains/messaging/workflow-text-settings";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) &&
  databaseUrl.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("COM-N1B job and maintenance texts (isolated PostgreSQL)", () => {
  const name = "n1b-" + randomUUID().slice(0, 8);
  const owner = name + "-owner", staffA = name + "-sa", staffB = name + "-sb", custUser = name + "-cu";
  const accountId = name + "-acct", numberId = name + "-num", customerId = name + "-cust";
  const jobId = name + "-job", doneJobId = name + "-done", maintId = name + "-maint", resolvedId = name + "-res";
  const recipient = "+13035550163";
  const noon = new Date("2026-10-20T18:00:00Z"); // 12:00 pm Colorado
  const visitAt = new Date("2026-10-27T20:00:00Z"); // 2:00 pm MDT
  const keyBefore = process.env.COMMUNICATION_CONTENT_KEY;
  let old: { customerSmsEnabled: boolean; communicationsPolicy: unknown; communicationsPolicyVersion: number };
  let version = 0; let n = 0;
  const token = () => `tok${String(++n).padStart(8, "0")}`;
  const fake = (): TelecomSmsProvider => ({
    sendSms: vi.fn(async () => ({ kind: "ACCEPTED" as const, resourceId: "SM" + randomBytes(16).toString("hex") })) });
  const send = async (actor: string, family: string, subjectId: string, provider: TelecomSmsProvider, sendAgain = false) => {
    const p = await getWorkflowTextPreview(actor, family, subjectId, noon);
    return sendWorkflowText(actor, { family, subjectId, clientToken: token(), expectedTextHash: p.textHash ?? "none", sendAgain },
      { provider, callbackOrigin: "https://example.test", now: noon });
  };

  beforeAll(async () => {
    process.env.COMMUNICATION_CONTENT_KEY = randomBytes(32).toString("base64");
    old = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" },
      select: { customerSmsEnabled: true, communicationsPolicy: true, communicationsPolicyVersion: true } });
    for (const [id, role] of [[owner, "OWNER"], [staffA, "STAFF"], [staffB, "STAFF"], [custUser, "CUSTOMER"]] as const) {
      await prisma.user.create({ data: { id, email: id + "@example.test", role, name: id === custUser ? "Jordan Rivers" : undefined } });
    }
    await prisma.customer.create({ data: { id: customerId, userId: custUser, referralCode: name, phone: "303-555-0163" } });
    await prisma.telecomAccount.create({ data: { id: accountId, environment: "TEST", provider: "twilio", externalAccountId: name, label: "TEST only", status: "READY" } });
    await prisma.businessPhoneNumber.create({ data: { id: numberId, accountId, address: "+13035550199", providerNumberId: numberId,
      capabilities: { sms: true, voice: false }, verifiedAt: new Date(), registrationStatus: "APPROVED" } });
    await prisma.job.create({ data: { id: jobId, type: "DELIVERY", status: "SCHEDULED", scheduledAt: visitAt, assignedToUserId: staffA, customerId } });
    await prisma.job.create({ data: { id: doneJobId, type: "REMOVAL", status: "COMPLETED", scheduledAt: new Date("2026-10-19T20:00:00Z"), assignedToUserId: staffA, customerId } });
    await prisma.maintenanceRequest.create({ data: { id: maintId, customerId, problem: "Not cooling", status: "SUBMITTED" } });
    await prisma.maintenanceRequest.create({ data: { id: resolvedId, customerId, problem: "Fixed", status: "RESOLVED" } });
    version = old.communicationsPolicyVersion + 1;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { customerSmsEnabled: true, communicationsPolicyVersion: version,
      communicationsPolicy: { schemaVersion: 1, manualSmsEnabled: true, primaryAccountId: accountId, primaryNumberId: numberId,
        approvedPolicyVersion: version, maxSegments: 3, supportedCountries: ["US"] } } });
    for (const key of ["job_scheduled", "job_completed", "maintenance_received", "maintenance_resolved"]) {
      const fam = (await import("@/domains/messaging/workflow-text-catalog")).workflowTextFamily(key)!;
      await approveWorkflowWording(owner, { family: key, body: fam.defaultBody });
      version = (await setWorkflowTextEnabled(owner, { family: key, enabled: true, expectedVersion: version })).version;
    }
  });

  afterAll(async () => {
    const threads = await prisma.communicationThread.findMany({ where: { accountId }, select: { id: true } });
    const tids = threads.map((t) => t.id);
    await prisma.communicationLink.deleteMany({ where: { message: { threadId: { in: tids } } } });
    await prisma.communicationMessage.deleteMany({ where: { threadId: { in: tids } } });
    const deliveries = await prisma.messageDelivery.findMany({ where: { subjectId: { in: tids } }, select: { id: true } });
    const dids = deliveries.map((d) => d.id);
    await prisma.messageDelivery.updateMany({ where: { id: { in: dids } }, data: { currentAttemptId: null } });
    await prisma.messageAttempt.deleteMany({ where: { deliveryId: { in: dids } } });
    await prisma.messageDelivery.deleteMany({ where: { id: { in: dids } } });
    const points = await prisma.contactPoint.findMany({ where: { address: recipient, environment: "TEST" }, select: { id: true } });
    const pids = points.map((p) => p.id);
    await prisma.communicationThread.deleteMany({ where: { externalContactPointId: { in: pids } } });
    await prisma.consentRecord.deleteMany({ where: { contactPointId: { in: pids } } });
    await prisma.contactBinding.deleteMany({ where: { contactPointId: { in: pids } } });
    await prisma.contactPoint.deleteMany({ where: { id: { in: pids } } });
    await prisma.communicationTemplateRevision.updateMany({ where: { createdByUserId: owner }, data: { isCurrent: false } });
    await prisma.communicationTemplateRevision.deleteMany({ where: { createdByUserId: owner, deliveries: { none: {} } } });
    await prisma.maintenanceRequest.deleteMany({ where: { id: { in: [maintId, resolvedId] } } });
    await prisma.job.deleteMany({ where: { id: { in: [jobId, doneJobId] } } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id: numberId } });
    await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [owner, staffA, staffB, custUser] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staffA, staffB, custUser] } } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { customerSmsEnabled: old.customerSmsEnabled,
      communicationsPolicy: old.communicationsPolicy as object, communicationsPolicyVersion: old.communicationsPolicyVersion } });
    if (keyBefore === undefined) delete process.env.COMMUNICATION_CONTENT_KEY; else process.env.COMMUNICATION_CONTENT_KEY = keyBefore;
  });

  it("assigned staff see a preview but cannot record permission; unassigned staff and customers are refused", async () => {
    const p = await getWorkflowTextPreview(staffA, "job_scheduled", jobId, noon);
    expect(p.text).toContain("Hi Jordan, your delivery is scheduled for");
    expect(p.text).toContain("Tue, Oct 27, 2:00 PM MDT");
    expect(p.blockers.map((b) => b.message).join(" ")).toMatch(/Ask the office/);
    expect(p.canRecordConsent).toBe(false);
    const provider = fake();
    expect((await send(staffA, "job_scheduled", jobId, provider)).kind).toBe("BLOCKED");
    await expect(recordStaffTextConsent(staffA, { principal: { customerId }, method: "PHONE" })).rejects.toThrow();
    await expect(getWorkflowTextPreview(staffB, "job_scheduled", jobId, noon)).rejects.toThrow();
    await expect(getWorkflowTextPreview(custUser, "job_scheduled", jobId, noon)).rejects.toThrow();
    await expect(getWorkflowTextPreview(staffA, "maintenance_received", maintId, noon)).rejects.toThrow();
    expect(provider.sendSms).not.toHaveBeenCalled();
  });

  it("after the office records permission, assigned staff send one visit text filed on the job", async () => {
    await recordStaffTextConsent(owner, { principal: { customerId }, method: "PHONE" }, noon);
    const provider = fake();
    const r = await send(staffA, "job_scheduled", jobId, provider);
    expect(r.kind).toBe("ACCEPTED");
    expect(provider.sendSms).toHaveBeenCalledTimes(1);
    const call = vi.mocked(provider.sendSms).mock.calls[0][0];
    expect(call.to).toBe(recipient);
    expect(call.text).toMatch(/scheduled for Tue, Oct 27/);
    expect(call.text).not.toMatch(/Main St|Street|\d{3,} /); // no address in the text
    expect(await prisma.communicationLink.count({ where: { entityType: "Job", entityId: jobId } })).toBe(1);
    const delivery = await prisma.messageDelivery.findFirstOrThrow({ where: { templateKey: "job_scheduled", actorUserId: staffA } });
    expect(delivery.state).toBe("ACCEPTED");
  });

  it("a job moved to another person is refused at the last moment", async () => {
    const preview = await getWorkflowTextPreview(staffA, "job_scheduled", jobId, noon);
    await prisma.job.update({ where: { id: jobId }, data: { assignedToUserId: staffB } });
    const provider = fake();
    await expect(sendWorkflowText(staffA, { family: "job_scheduled", subjectId: jobId, clientToken: token(),
      expectedTextHash: preview.textHash!, sendAgain: true }, { provider, callbackOrigin: "https://example.test", now: noon })).rejects.toThrow();
    expect(provider.sendSms).not.toHaveBeenCalled();
    await prisma.job.update({ where: { id: jobId }, data: { assignedToUserId: staffA } });
  });

  it("each text only fits the right state of the visit or request", async () => {
    expect((await getWorkflowTextPreview(owner, "job_completed", jobId, noon)).blockers.map((b) => b.message).join(" ")).toMatch(/not been marked completed/);
    expect((await getWorkflowTextPreview(owner, "job_scheduled", doneJobId, noon)).blockers.map((b) => b.message).join(" ")).toMatch(/already done/);
    expect((await getWorkflowTextPreview(owner, "job_completed", doneJobId, noon)).ready).toBe(true);
    expect((await getWorkflowTextPreview(owner, "maintenance_resolved", maintId, noon)).blockers.map((b) => b.message).join(" ")).toMatch(/not been marked resolved/);
    expect((await getWorkflowTextPreview(owner, "maintenance_received", resolvedId, noon)).blockers.map((b) => b.message).join(" ")).toMatch(/already finished/);
    expect((await getWorkflowTextPreview(owner, "job_on_the_way", jobId, noon)).blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining(["WRONG_STATE"])); // not scheduled for today, and switched off
  });

  it("owner sends a maintenance text; the other kinds remain off until switched on", async () => {
    const provider = fake();
    const r = await send(owner, "maintenance_received", maintId, provider);
    expect(r.kind).toBe("ACCEPTED");
    expect(vi.mocked(provider.sendSms).mock.calls[0][0].text).toMatch(/received your maintenance request/);
    expect(await prisma.communicationLink.count({ where: { entityType: "MaintenanceRequest", entityId: maintId } })).toBe(1);
    const off = await getWorkflowTextPreview(owner, "job_reminder", jobId, noon);
    expect(off.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["NOT_APPROVED", "FAMILY_OFF"]));
  });

  it("a job with no customer cannot be texted", async () => {
    const orphan = name + "-orphan";
    await prisma.job.create({ data: { id: orphan, type: "DELIVERY", status: "SCHEDULED", scheduledAt: visitAt } });
    try {
      expect((await getWorkflowTextPreview(owner, "job_scheduled", orphan, noon)).blockers.map((b) => b.code)).toContain("NOT_FOUND");
    } finally { await prisma.job.delete({ where: { id: orphan } }); }
  });
});
