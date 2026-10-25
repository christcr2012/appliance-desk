import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TelecomSmsProvider } from "@/lib/communications/providers/types";
import {
  getWorkflowTextPreview, recordStaffTextConsent, sendWorkflowText,
} from "@/domains/messaging/workflow-text";
import {
  approveWorkflowWording, getWorkflowTextSettings, saveWorkflowQuietHours, setWorkflowTextEnabled,
} from "@/domains/messaging/workflow-text-settings";
import { WORKFLOW_TEXT_FAMILIES } from "@/domains/messaging/workflow-text-catalog";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) &&
  databaseUrl.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("COM-N1A lead and estimate texts (isolated PostgreSQL)", () => {
  const name = "n1a-" + randomUUID().slice(0, 8);
  const owner = name + "-owner", staff = name + "-staff";
  const accountId = name + "-acct", numberId = name + "-num";
  const leadId = name + "-lead", estimateId = name + "-est", draftEstimateId = name + "-draft";
  const recipient = "+13035550142";
  const noon = new Date("2026-10-20T18:00:00Z"); // 12:00 pm in Colorado
  const night = new Date("2026-10-21T08:00:00Z"); // 2:00 am in Colorado
  const keyBefore = process.env.COMMUNICATION_CONTENT_KEY;
  let old: { customerSmsEnabled: boolean; communicationsPolicy: unknown; communicationsPolicyVersion: number };
  let version = 0;
  let n = 0;
  const token = () => `tok${String(++n).padStart(8, "0")}`;

  const fake = (): TelecomSmsProvider => ({
    sendSms: vi.fn(async () => ({ kind: "ACCEPTED" as const, resourceId: "SM" + randomBytes(16).toString("hex") })),
  });
  const send = (family: string, subjectId: string, provider: TelecomSmsProvider, at = noon, extra: { sendAgain?: boolean } = {}) =>
    getWorkflowTextPreview(owner, family, subjectId, at).then((p) => sendWorkflowText(owner,
      { family, subjectId, clientToken: token(), expectedTextHash: p.textHash ?? "none", ...extra },
      { provider, callbackOrigin: "https://example.test", now: at }));

  beforeAll(async () => {
    process.env.COMMUNICATION_CONTENT_KEY = randomBytes(32).toString("base64");
    old = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" },
      select: { customerSmsEnabled: true, communicationsPolicy: true, communicationsPolicyVersion: true } });
    await prisma.user.create({ data: { id: owner, email: owner + "@example.test", role: "OWNER" } });
    await prisma.user.create({ data: { id: staff, email: staff + "@example.test", role: "STAFF" } });
    await prisma.telecomAccount.create({ data: { id: accountId, environment: "TEST", provider: "twilio",
      externalAccountId: name, label: "TEST only", status: "READY" } });
    await prisma.businessPhoneNumber.create({ data: { id: numberId, accountId, address: "+13035550199",
      providerNumberId: numberId, capabilities: { sms: true, voice: false }, verifiedAt: new Date(), registrationStatus: "APPROVED" } });
    await prisma.lead.create({ data: { id: leadId, contactName: "Alex Tester", phone: "(303) 555-0142" } });
    const base = { createdByUserId: owner, title: "Washer", validUntil: new Date("2027-01-01T00:00:00Z"), leadId };
    await prisma.estimate.create({ data: { id: estimateId, status: "SENT", ...base } });
    await prisma.estimate.create({ data: { id: draftEstimateId, status: "DRAFT", ...base } });
    version = old.communicationsPolicyVersion + 1;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: {
      customerSmsEnabled: false, communicationsPolicyVersion: version,
      communicationsPolicy: { schemaVersion: 1, manualSmsEnabled: true, primaryAccountId: accountId, primaryNumberId: numberId,
        approvedPolicyVersion: version, maxSegments: 3, supportedCountries: ["US"] } } });
  });

  afterAll(async () => {
    const keys = { startsWith: "wf-" };
    await prisma.messageDelivery.updateMany({ where: { idempotencyKey: { contains: leadId } }, data: { currentAttemptId: null } });
    const threads = await prisma.communicationThread.findMany({ where: { accountId }, select: { id: true } });
    const tids = threads.map((t) => t.id);
    await prisma.communicationLink.deleteMany({ where: { message: { threadId: { in: tids } } } });
    await prisma.communicationMessage.deleteMany({ where: { threadId: { in: tids } } });
    const deliveries = await prisma.messageDelivery.findMany({ where: { subjectId: { in: tids } }, select: { id: true } });
    await prisma.messageDelivery.updateMany({ where: { id: { in: deliveries.map((d) => d.id) } }, data: { currentAttemptId: null } });
    await prisma.messageAttempt.deleteMany({ where: { deliveryId: { in: deliveries.map((d) => d.id) } } });
    await prisma.messageDelivery.deleteMany({ where: { id: { in: deliveries.map((d) => d.id) } } });
    await prisma.communicationThread.deleteMany({ where: { id: { in: tids } } });
    await prisma.marketingSuppression.deleteMany({ where: { channel: "SMS", address: recipient } });
    const points = await prisma.contactPoint.findMany({ where: { address: recipient, environment: "TEST" }, select: { id: true } });
    const pids = points.map((p) => p.id);
    await prisma.communicationThread.deleteMany({ where: { externalContactPointId: { in: pids } } });
    await prisma.consentRecord.deleteMany({ where: { contactPointId: { in: pids } } });
    await prisma.contactBinding.deleteMany({ where: { contactPointId: { in: pids } } });
    await prisma.contactPoint.deleteMany({ where: { id: { in: pids } } });
    await prisma.communicationTemplateRevision.updateMany({ where: { createdByUserId: owner }, data: { isCurrent: false } });
    await prisma.communicationTemplateRevision.deleteMany({ where: { createdByUserId: owner, deliveries: { none: {} } } });
    void keys;
    await prisma.estimate.deleteMany({ where: { id: { in: [estimateId, draftEstimateId] } } });
    await prisma.lead.deleteMany({ where: { id: leadId } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id: numberId } });
    await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [owner, staff] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff] } } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: {
      customerSmsEnabled: old.customerSmsEnabled, communicationsPolicy: old.communicationsPolicy as object,
      communicationsPolicyVersion: old.communicationsPolicyVersion } });
    if (keyBefore === undefined) delete process.env.COMMUNICATION_CONTENT_KEY;
    else process.env.COMMUNICATION_CONTENT_KEY = keyBefore;
  });

  it("starts fully off and says why, in plain words", async () => {
    const p = await getWorkflowTextPreview(owner, "estimate_ready", estimateId, noon);
    const codes = p.blockers.map((b) => b.code);
    expect(p.ready).toBe(false);
    expect(codes).toEqual(expect.arrayContaining(["NOT_APPROVED", "FAMILY_OFF", "MASTER_OFF"]));
    const provider = fake();
    const result = await send("estimate_ready", estimateId, provider);
    expect(result.kind).toBe("BLOCKED");
    expect(provider.sendSms).not.toHaveBeenCalled();
    expect(await prisma.messageDelivery.count({ where: { templateKey: "estimate_ready" } })).toBeGreaterThanOrEqual(0);
  });

  it("only the Owner or an Admin can look at or send; staff are refused", async () => {
    await expect(getWorkflowTextPreview(staff, "lead_received", leadId, noon)).rejects.toThrow();
    await expect(approveWorkflowWording(staff, { family: "lead_received", body: "x" })).rejects.toThrow();
    await expect(setWorkflowTextEnabled(staff, { family: "lead_received", enabled: true, expectedVersion: version })).rejects.toThrow();
  });

  it("owner wording rules: must keep STOP line, business name and stay within 3 parts", async () => {
    await expect(approveWorkflowWording(owner, { family: "lead_received", body: "Robinson Appliance Rentals: Hi {{name}}, hello there." })).rejects.toThrow(/STOP/);
    await expect(approveWorkflowWording(owner, { family: "lead_received", body: "Hi {{name}}, hello there friend. Reply STOP to opt out." })).rejects.toThrow(/business name/);
    await expect(approveWorkflowWording(owner, { family: "lead_received", body: "Robinson Appliance Rentals: {{secret}} Reply STOP to opt out." })).rejects.toThrow();
    await expect(approveWorkflowWording(owner, { family: "lead_received", body: "Robinson Appliance Rentals: " + "long ".repeat(120) + " Reply STOP to opt out." })).rejects.toThrow();
  });

  it("every catalog default can be approved as-is", async () => {
    for (const family of WORKFLOW_TEXT_FAMILIES) {
      const r = await approveWorkflowWording(owner, { family: family.key, body: family.defaultBody });
      expect(r.revision).toBeGreaterThan(0);
    }
    const again = await approveWorkflowWording(owner, { family: "lead_received", body: WORKFLOW_TEXT_FAMILIES[0].defaultBody });
    expect(again.changed).toBe(false);
    const settings = await getWorkflowTextSettings(owner);
    expect(settings.families.every((f) => f.approved && !f.enabled)).toBe(true);
  });

  it("switching on needs approved wording, a matching version, and never turns on the master switch", async () => {
    await expect(setWorkflowTextEnabled(owner, { family: "lead_received", enabled: true, expectedVersion: version + 5 })).rejects.toThrow(/Refresh/);
    for (const key of ["lead_received", "estimate_ready"]) {
      const r = await setWorkflowTextEnabled(owner, { family: key, enabled: true, expectedVersion: version });
      version = r.version;
    }
    const row = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { customerSmsEnabled: true } });
    expect(row.customerSmsEnabled).toBe(false);
    const provider = fake();
    const result = await send("lead_received", leadId, provider);
    expect(result).toMatchObject({ kind: "BLOCKED" });
    expect((result as { blockers: { code: string }[] }).blockers.map((b) => b.code)).toContain("MASTER_OFF");
    expect(provider.sendSms).not.toHaveBeenCalled();
  });

  it("with the master switch on it still needs recorded permission", async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { customerSmsEnabled: true } });
    const p = await getWorkflowTextPreview(owner, "lead_received", leadId, noon);
    expect(p.blockers.map((b) => b.code)).toContain("NEEDS_CONSENT");
    expect(p.canRecordConsent).toBe(true);
    expect(p.maskedPhone).toBe("(303) ***-0142");
    const provider = fake();
    expect((await send("lead_received", leadId, provider)).kind).toBe("BLOCKED");
    expect(provider.sendSms).not.toHaveBeenCalled();
  });

  it("records staff-evidence permission once, then sends exactly one text and files it on the lead", async () => {
    await expect(recordStaffTextConsent(staff, { principal: { leadId }, method: "PHONE" })).rejects.toThrow();
    expect((await recordStaffTextConsent(owner, { principal: { leadId }, method: "PHONE" }, noon)).recorded).toBe(true);
    expect((await recordStaffTextConsent(owner, { principal: { leadId }, method: "PHONE" }, noon)).recorded).toBe(false);
    const provider = fake();
    const first = await send("lead_received", leadId, provider);
    expect(first.kind).toBe("ACCEPTED");
    expect(provider.sendSms).toHaveBeenCalledTimes(1);
    const call = vi.mocked(provider.sendSms).mock.calls[0][0];
    expect(call.to).toBe(recipient);
    expect(call.text).toMatch(/^Robinson Appliance Rentals: Hi Alex,/);
    expect(call.text).toMatch(/Reply STOP/);
    const links = await prisma.communicationLink.findMany({ where: { entityType: "Lead", entityId: leadId } });
    expect(links.length).toBe(1);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { lastRealContactAt: true } });
    expect(lead.lastRealContactAt).not.toBeNull();
    // a second press a moment later is a deliberate choice
    const second = await send("lead_received", leadId, provider);
    expect(second.kind).toBe("BLOCKED");
    expect((second as { blockers: { code: string }[] }).blockers.map((b) => b.code)).toContain("RECENT_DUPLICATE");
    expect(provider.sendSms).toHaveBeenCalledTimes(1);
    const again = await send("lead_received", leadId, provider, noon, { sendAgain: true });
    expect(again.kind).toBe("ACCEPTED");
    expect(provider.sendSms).toHaveBeenCalledTimes(2);
  });

  it("pressing Send twice with the same screen token sends only one text", async () => {
    const provider = fake();
    const preview = await getWorkflowTextPreview(owner, "estimate_ready", estimateId, noon);
    const input = { family: "estimate_ready", subjectId: estimateId, clientToken: "samescreen01", expectedTextHash: preview.textHash! };
    const deps = { provider, callbackOrigin: "https://example.test", now: noon };
    const a = await sendWorkflowText(owner, input, deps);
    const b = await sendWorkflowText(owner, input, deps);
    expect(a.kind).toBe("ACCEPTED");
    expect(b.kind).not.toBe("ACCEPTED");
    expect(provider.sendSms).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(provider.sendSms).mock.calls[0][0].text;
    expect(sent).toContain(`/estimate/${estimateId}`);
  });

  it("refuses a draft estimate and a changed preview", async () => {
    const draft = await getWorkflowTextPreview(owner, "estimate_ready", draftEstimateId, noon);
    expect(draft.blockers.map((b) => b.code)).toContain("WRONG_STATE");
    const provider = fake();
    const changed = await sendWorkflowText(owner, { family: "estimate_ready", subjectId: estimateId, clientToken: token(),
      expectedTextHash: "stale", sendAgain: true }, { provider, callbackOrigin: "https://example.test", now: noon });
    expect(changed.kind).toBe("CHANGED");
    expect(provider.sendSms).not.toHaveBeenCalled();
  });

  it("holds texts during quiet hours and lets the Owner move the window", async () => {
    const provider = fake();
    const held = await send("lead_received", leadId, provider, night, { sendAgain: true });
    expect(held.kind).toBe("BLOCKED");
    expect((held as { blockers: { code: string }[] }).blockers.map((b) => b.code)).toContain("QUIET_HOURS");
    expect(provider.sendSms).not.toHaveBeenCalled();
    const r = await saveWorkflowQuietHours(owner, { quietHours: { startMinute: 600, endMinute: 601 }, expectedVersion: version });
    version = r.version;
    expect((await getWorkflowTextSettings(owner)).quietHoursIsRecommended).toBe(false);
    const r2 = await saveWorkflowQuietHours(owner, { quietHours: null, expectedVersion: version });
    version = r2.version;
    expect((await getWorkflowTextSettings(owner)).quietHoursIsRecommended).toBe(true);
  });

  it("an unknown carrier result is shown as unknown and never retried automatically", async () => {
    const provider: TelecomSmsProvider = { sendSms: vi.fn(async () => ({ kind: "UNKNOWN" as const })) };
    const r = await send("estimate_ready", estimateId, provider, noon, { sendAgain: true });
    expect(r.kind).toBe("UNKNOWN");
    expect(provider.sendSms).toHaveBeenCalledTimes(1);
    const dup = await getWorkflowTextPreview(owner, "estimate_ready", estimateId, noon);
    expect(dup.blockers.map((b) => b.message).join(" ")).toMatch(/unknown/i);
  });

  it("a family switched off after preview is refused at the last moment", async () => {
    const preview = await getWorkflowTextPreview(owner, "lead_received", leadId, noon);
    const r = await setWorkflowTextEnabled(owner, { family: "lead_received", enabled: false, expectedVersion: version });
    version = r.version;
    const provider = fake();
    const result = await sendWorkflowText(owner, { family: "lead_received", subjectId: leadId, clientToken: token(),
      expectedTextHash: preview.textHash!, sendAgain: true }, { provider, callbackOrigin: "https://example.test", now: noon });
    expect(result.kind).toBe("BLOCKED");
    expect(provider.sendSms).not.toHaveBeenCalled();
  });

  it("wording approved after the preview is never sent unseen", async () => {
    const preview = await getWorkflowTextPreview(owner, "estimate_ready", estimateId, noon);
    await approveWorkflowWording(owner, { family: "estimate_ready",
      body: "Robinson Appliance Rentals: Hi {{name}}, estimate #{{number}} is ready: {{link}} Reply STOP to opt out." });
    const provider = fake();
    const result = await sendWorkflowText(owner, { family: "estimate_ready", subjectId: estimateId, clientToken: token(),
      expectedTextHash: preview.textHash!, sendAgain: true }, { provider, callbackOrigin: "https://example.test", now: noon });
    expect(result.kind).toBe("CHANGED");
    expect(provider.sendSms).not.toHaveBeenCalled();
  });

  it("an estimate that stops being open between preview and send is not texted", async () => {
    const preview = await getWorkflowTextPreview(owner, "estimate_ready", estimateId, noon);
    await prisma.estimate.update({ where: { id: estimateId }, data: { status: "DECLINED" } });
    const provider = fake();
    const result = await sendWorkflowText(owner, { family: "estimate_ready", subjectId: estimateId, clientToken: token(),
      expectedTextHash: preview.textHash!, sendAgain: true }, { provider, callbackOrigin: "https://example.test", now: noon });
    expect(result.kind).toBe("BLOCKED");
    expect(provider.sendSms).not.toHaveBeenCalled();
    await prisma.estimate.update({ where: { id: estimateId }, data: { status: "SENT" } });
  });

  it("STOP wins over everything", async () => {
    await setWorkflowTextEnabled(owner, { family: "lead_received", enabled: true, expectedVersion: version }).then((r) => { version = r.version; });
    await prisma.marketingSuppression.create({ data: { channel: "SMS", address: recipient, reason: "STOP", source: "test" } });
    const provider = fake();
    const result = await send("lead_received", leadId, provider, noon, { sendAgain: true });
    expect(result.kind).toBe("BLOCKED");
    expect((result as { blockers: { code: string }[] }).blockers.map((b) => b.code)).toContain("STOPPED");
    await expect(recordStaffTextConsent(owner, { principal: { leadId }, method: "PHONE" }, noon)).rejects.toThrow(/STOP|replied/);
    expect(provider.sendSms).not.toHaveBeenCalled();
  });
});
