import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TelecomVoiceProvider } from "@/lib/communications/providers/types";
import { getClickToCallPreview, startClickToCall } from "@/domains/messaging/click-to-call";
import { clickToCallStep } from "@/domains/messaging/voice-webhooks";
import type { VerifiedVoice } from "@/domains/messaging/voice-webhook-verify";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("COM-N2 click-to-call (isolated PostgreSQL)", () => {
  const name = "n2-" + randomUUID().slice(0, 8);
  const owner = name + "-owner", staffA = name + "-sa", staffB = name + "-sb", custUser = name + "-cu";
  const accountId = name + "-acct", numberId = name + "-num", customerId = name + "-cust", jobId = name + "-job";
  const customerPhone = "+13035550177", ownerPhone = "+13035550178", staffAPhone = "+13035550179";
  const now = new Date("2026-10-20T18:00:00Z");
  let old: { customerSmsEnabled: boolean; communicationsPolicy: unknown; communicationsPolicyVersion: number };
  let version = 0; let n = 0;
  const token = () => `tok${String(++n).padStart(8, "0")}`;
  const fake = (kind: "ok" | "reject" | "unknown" = "ok"): TelecomVoiceProvider => ({
    createCall: vi.fn(async () => kind === "ok" ? { kind: "ACCEPTED" as const, resourceId: "CA" + randomUUID().replace(/-/g, "") }
      : kind === "reject" ? { kind: "REJECTED" as const, code: "21211" } : { kind: "UNKNOWN" as const }) });
  const deps = (provider: TelecomVoiceProvider) => ({ provider, callbackOrigin: "https://example.test", now });
  const policy = (extra: object = {}) => ({ schemaVersion: 1, manualSmsEnabled: true, primaryAccountId: accountId, primaryNumberId: numberId,
    approvedPolicyVersion: version, maxSegments: 3, supportedCountries: ["US"], voiceRoutingEnabled: true, clickToCallEnabled: true, ...extra });
  const setPolicy = async (extra: object = {}) => {
    version += 1;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { communicationsPolicyVersion: version, communicationsPolicy: policy(extra) } });
  };
  const voice = (callSid: string, form: Record<string, string> = {}, extra: object = {}): VerifiedVoice => ({
    form: new URLSearchParams(form), accountId, accountSid: name, callSid, path: "/x", canonicalOrigin: "https://example.test",
    policy: policy(extra) as VerifiedVoice["policy"], policyVersion: version });

  const keyBefore = process.env.COMMUNICATION_CONTENT_KEY;
  beforeAll(async () => {
    process.env.COMMUNICATION_CONTENT_KEY = randomBytes(32).toString("base64");
    old = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" },
      select: { customerSmsEnabled: true, communicationsPolicy: true, communicationsPolicyVersion: true } });
    const phones: Record<string, string | undefined> = { [owner]: ownerPhone, [staffA]: staffAPhone };
    for (const [id, role] of [[owner, "OWNER"], [staffA, "STAFF"], [staffB, "STAFF"], [custUser, "CUSTOMER"]] as const) {
      await prisma.user.create({ data: { id, email: id + "@example.test", role, name: id === custUser ? "Jordan Rivers" : undefined,
        phone: phones[id], phoneConfirmedAt: phones[id] ? now : undefined } });
    }
    await prisma.customer.create({ data: { id: customerId, userId: custUser, referralCode: name, phone: "303-555-0177" } });
    await prisma.telecomAccount.create({ data: { id: accountId, environment: "TEST", provider: "twilio", externalAccountId: name, label: "TEST only", status: "READY" } });
    await prisma.businessPhoneNumber.create({ data: { id: numberId, accountId, address: "+13035550199", providerNumberId: numberId,
      capabilities: { sms: true, voice: true }, verifiedAt: new Date(), registrationStatus: "APPROVED" } });
    await prisma.job.create({ data: { id: jobId, type: "DELIVERY", status: "SCHEDULED", scheduledAt: new Date("2026-10-27T20:00:00Z"), assignedToUserId: staffA, customerId } });
    version = old.communicationsPolicyVersion;
    await setPolicy();
  });

  afterAll(async () => {
    const sessions = await prisma.callSession.findMany({ where: { accountId }, select: { id: true } });
    const sids = sessions.map((s) => s.id);
    await prisma.callLeg.deleteMany({ where: { callSessionId: { in: sids } } });
    await prisma.callSession.deleteMany({ where: { id: { in: sids } } });
    await prisma.providerEvent.deleteMany({ where: { telecomAccountId: accountId } });
    const points = await prisma.contactPoint.findMany({ where: { address: customerPhone, environment: "TEST" }, select: { id: true } });
    const pids = points.map((p) => p.id);
    await prisma.communicationThread.deleteMany({ where: { externalContactPointId: { in: pids } } });
    await prisma.contactBinding.deleteMany({ where: { contactPointId: { in: pids } } });
    await prisma.contactPoint.deleteMany({ where: { id: { in: pids } } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id: numberId } });
    await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [owner, staffA, staffB, custUser] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staffA, staffB, custUser] } } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { customerSmsEnabled: old.customerSmsEnabled,
      communicationsPolicy: old.communicationsPolicy as object, communicationsPolicyVersion: old.communicationsPolicyVersion } });
    if (keyBefore === undefined) delete process.env.COMMUNICATION_CONTENT_KEY; else process.env.COMMUNICATION_CONTENT_KEY = keyBefore;
  });

  const job = { type: "Job" as const, id: jobId };

  it("is off unless the Owner switched it on, and then the carrier is never contacted", async () => {
    await setPolicy({ clickToCallEnabled: false });
    const p = fake();
    expect((await getClickToCallPreview(owner, job, now)).available).toBe(false);
    expect((await startClickToCall(owner, { subject: job, clientToken: token() }, deps(p))).status).toBe("NOT_STARTED");
    expect(p.createCall).not.toHaveBeenCalled();
    await setPolicy();
  });

  it("only owner/admin or the assigned staff member may call; others and customers are refused", async () => {
    const p = fake();
    expect((await getClickToCallPreview(staffB, job, now))).toMatchObject({ available: false });
    expect((await startClickToCall(staffB, { subject: job, clientToken: token() }, deps(p))).status).toBe("NOT_STARTED");
    await expect(startClickToCall(custUser, { subject: job, clientToken: token() }, deps(p))).rejects.toThrow();
    expect(p.createCall).not.toHaveBeenCalled();
  });

  it("needs the staff member's own confirmed phone", async () => {
    const p = fake();
    const r = await getClickToCallPreview(staffB, { type: "Job", id: jobId }, now);
    expect(r.available).toBe(false);
    await prisma.user.update({ where: { id: staffA }, data: { phoneConfirmedAt: null } });
    const preview = await getClickToCallPreview(staffA, job, now);
    expect(preview).toMatchObject({ available: false });
    expect((preview as { reason: string }).reason).toMatch(/Confirm your own mobile/);
    await prisma.user.update({ where: { id: staffA }, data: { phoneConfirmedAt: now } });
    expect(p.createCall).not.toHaveBeenCalled();
  });

  it("assigned staff start a call: the carrier rings the STAFF phone, never the customer, and a repeat click is one call", async () => {
    const p = fake();
    const t = token();
    const r = await startClickToCall(staffA, { subject: job, clientToken: t }, deps(p));
    expect(r).toMatchObject({ status: "STARTED" });
    expect(p.createCall).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(p.createCall).mock.calls[0][0];
    expect(sent.to).toBe(staffAPhone);
    expect(sent.from).toBe("+13035550199");
    expect(sent.url).toContain("/api/webhooks/twilio/voice/click-to-call?op=");
    expect(JSON.stringify(sent)).not.toContain(customerPhone);
    const again = await startClickToCall(staffA, { subject: job, clientToken: t }, deps(p));
    expect(again.status).toBe("STARTED");
    expect(p.createCall).toHaveBeenCalledTimes(1);
    const session = await prisma.callSession.findUniqueOrThrow({ where: { id: (r as { sessionId: string }).sessionId } });
    expect(session).toMatchObject({ direction: "OUTBOUND", actorUserId: staffA, state: "RINGING" });
    expect(session.providerRootCallId.startsWith("CA")).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "COMMUNICATION_CALL_STARTED", entityId: jobId, userId: staffA } })).toBe(1);
    // a second call straight away is refused while one is in progress
    const second = await startClickToCall(staffA, { subject: job, clientToken: token() }, deps(fake()));
    expect(second.status).toBe("NOT_STARTED");
  });

  it("the customer is dialed only after the staff member presses 1, using our saved number, and authority is rechecked", async () => {
    await prisma.callSession.updateMany({ where: { accountId }, data: { state: "ENDED", endedAt: new Date(), outcome: "MISSED" } });
    const p = fake();
    const r = await startClickToCall(owner, { subject: job, clientToken: token() }, deps(p)) as { sessionId: string };
    const session = await prisma.callSession.findUniqueOrThrow({ where: { id: r.sessionId } });
    const sid = session.providerRootCallId;
    const prompt = await clickToCallStep(voice(sid), r.sessionId, "prompt");
    expect(prompt).toContain("Press 1");
    expect(prompt).not.toContain(customerPhone);
    // wrong digit: hang up, never dial
    const no = await clickToCallStep(voice(sid, { Digits: "2" }), r.sessionId, "decision");
    expect(no).not.toContain("<Dial");
    expect((await prisma.callSession.findUniqueOrThrow({ where: { id: r.sessionId } })).outcome).toBe("DECLINED");
  });

  it("press 1 dials the saved customer number with the business caller ID; callbacks cannot inject a number", async () => {
    await prisma.callSession.updateMany({ where: { accountId }, data: { state: "ENDED", endedAt: new Date(), outcome: "MISSED" } });
    const p = fake();
    const r = await startClickToCall(owner, { subject: job, clientToken: token() }, deps(p)) as { sessionId: string };
    const sid = (await prisma.callSession.findUniqueOrThrow({ where: { id: r.sessionId } })).providerRootCallId;
    await clickToCallStep(voice(sid), r.sessionId, "prompt");
    const xml = await clickToCallStep(voice(sid, { Digits: "1", To: "+19995550000", Number: "+19995550000" }), r.sessionId, "decision");
    expect(xml).toContain("<Dial");
    expect(xml).toContain(customerPhone);
    expect(xml).toContain('callerId="+13035550199"');
    expect(xml).not.toContain("9995550000");
    const done = await clickToCallStep(voice(sid, { DialCallStatus: "completed", DialBridged: "true" }), r.sessionId, "done");
    expect(done).toContain("<Hangup");
    expect(await prisma.callSession.findUniqueOrThrow({ where: { id: r.sessionId } })).toMatchObject({ outcome: "ANSWERED", state: "ENDED" });
    // a callback for a different call is refused
    await expect(clickToCallStep(voice("CAother"), r.sessionId, "decision")).rejects.toThrow();
  });

  it("a job moved to someone else, or the switch turned off, stops the call before the customer is dialed", async () => {
    await prisma.callSession.updateMany({ where: { accountId }, data: { state: "ENDED", endedAt: new Date(), outcome: "MISSED" } });
    const r = await startClickToCall(staffA, { subject: job, clientToken: token() }, deps(fake())) as { sessionId: string };
    const sid = (await prisma.callSession.findUniqueOrThrow({ where: { id: r.sessionId } })).providerRootCallId;
    await clickToCallStep(voice(sid), r.sessionId, "prompt");
    await prisma.job.update({ where: { id: jobId }, data: { assignedToUserId: staffB } });
    const xml = await clickToCallStep(voice(sid, { Digits: "1" }), r.sessionId, "decision");
    expect(xml).not.toContain("<Dial");
    await prisma.job.update({ where: { id: jobId }, data: { assignedToUserId: staffA } });
    await prisma.callSession.updateMany({ where: { accountId }, data: { state: "ENDED", endedAt: new Date(), outcome: "MISSED" } });
    const r2 = await startClickToCall(staffA, { subject: job, clientToken: token() }, deps(fake())) as { sessionId: string };
    const sid2 = (await prisma.callSession.findUniqueOrThrow({ where: { id: r2.sessionId } })).providerRootCallId;
    await clickToCallStep(voice(sid2), r2.sessionId, "prompt");
    await setPolicy({ clickToCallEnabled: false });
    const xml2 = await clickToCallStep(voice(sid2, { Digits: "1" }, { clickToCallEnabled: false }), r2.sessionId, "decision");
    expect(xml2).not.toContain("<Dial");
    await setPolicy();
  });

  it("a carrier refusal fails the call; an unclear answer is recorded as unconfirmed and not retried", async () => {
    await prisma.callSession.updateMany({ where: { accountId }, data: { state: "ENDED", endedAt: new Date(), outcome: "MISSED" } });
    expect((await startClickToCall(owner, { subject: job, clientToken: token() }, deps(fake("reject")))).status).toBe("NOT_STARTED");
    const p = fake("unknown");
    const t = token();
    const u = await startClickToCall(owner, { subject: job, clientToken: t }, deps(p));
    expect(u.status).toBe("UNCONFIRMED");
    expect((await prisma.callSession.findUniqueOrThrow({ where: { id: (u as { sessionId: string }).sessionId } })).outcome).toBe("UNKNOWN");
    const p2 = fake();
    expect((await startClickToCall(owner, { subject: job, clientToken: token() }, deps(p2))).status).toBe("NOT_STARTED");
    expect(p2.createCall).not.toHaveBeenCalled();
  });

  it("without the disposable test harness no carrier is contacted (not production)", async () => {
    await prisma.callSession.updateMany({ where: { accountId }, data: { state: "ENDED", endedAt: new Date(), outcome: "MISSED" } });
    const p = fake();
    const r = await startClickToCall(owner, { subject: job, clientToken: token() }, { provider: p, now }); // no origin
    expect(r.status).toBe("NOT_STARTED");
    expect(p.createCall).not.toHaveBeenCalled();
  });
});
