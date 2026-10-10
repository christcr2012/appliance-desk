import { afterAll, beforeAll, describe, expect, it } from "vitest";
import twilio from "twilio";
import { prisma } from "@/lib/prisma";
import { POST as inbound } from "@/app/api/webhooks/twilio/voice/route";
import { POST as complete } from "@/app/api/webhooks/twilio/voice/record-complete/route";
import { POST as dialResult } from "@/app/api/webhooks/twilio/voice/dial-result/route";
import { POST as mediaRoute } from "@/app/api/webhooks/twilio/voice/media/route";
import { verifyVoiceRequest } from "@/domains/messaging/voice-webhook-verify";
import { ingestVoicemailCallback } from "@/domains/messaging/voice-voicemail";
import { getPrivateVoiceMediaForRead, listMissedCallInbox } from "@/domains/messaging/voice-media";

const connection = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const local = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(connection.hostname) &&
  connection.pathname === "/appliance_desk_test";
const origin = "https://voicemail.example.test";
const token = "synthetic-voicemail-test-auth-token";
const acct = "AC" + "b".repeat(32);
const number = "+13035551991";
const caller = "+13035551992";
const target = "+13035551993";
const ownerId = "com-l9-owner", staffId = "com-l9-staff";
const accountId = "com-l9-account", phoneId = "com-l9-phone";
const root = "CA" + "7".repeat(32);
const second = "CA" + "8".repeat(32);
const third = "CA" + "9".repeat(32);
const fourth = "CA" + "e".repeat(32);
const child = "CA" + "d".repeat(32);
const firstRec = "RE" + "b".repeat(32);
const secondRec = "RE" + "c".repeat(32);
const extraRec = "RE" + "d".repeat(32);
const voicemail = {
  enabled: true, onMissedCall: true,
  announcement: "After the tone, please leave a private message for our team.",
  maxSeconds: 45, retentionDays: 30, approvedPolicyVersion: 1,
};
const routing = {
  timezone: "America/Denver", forwardTo: target,
  destinationVerifiedAt: "2026-01-01T00:00:00Z",
  destinationApprovedAt: "2026-01-01T00:00:00Z",
  timeoutSeconds: 20,
  weeklyHours: [],
  closedDates: [],
  afterHoursMode: "VOICEMAIL", voicemail,
  greeting: "We are closed.", unavailableGreeting: "We are unavailable.",
};

function request(path: string, form: Record<string, string>, signed = true) {
  const url = origin + path;
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(signed ? { "x-twilio-signature":
        twilio.getExpectedTwilioSignature(token, url, form) } : {}),
    },
    body: new URLSearchParams(form).toString(),
  });
}
function inboundForm(callSid: string) {
  return { AccountSid: acct, CallSid: callSid, From: caller, To: number };
}
function mediaForm(callSid: string, recordingSid: string) {
  return { AccountSid: acct, CallSid: callSid, RecordingSid: recordingSid,
    RecordingStatus: "completed", RecordingDuration: "18", RecordingSource: "RecordVerb" };
}
async function signedMedia(callSid: string, recordingSid: string) {
  const verified = await verifyVoiceRequest(
    request("/api/webhooks/twilio/voice/media", mediaForm(callSid, recordingSid)),
    "/api/webhooks/twilio/voice/media",
  );
  if ("error" in verified) throw new Error("Synthetic media callback did not verify");
  return verified.verified;
}
describe.skipIf(!local)("COM-L9 voicemail gates/private lifecycle (real PostgreSQL)", () => {
  const original: Record<string, string | undefined> = {};
  let oldPolicy: unknown;
  let oldVersion = 0;
  async function saveRouting(hours: Array<{ weekday: number; from: string; to: string }>) {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: {
      communicationsPolicyVersion: 1,
      communicationsPolicy: {
        schemaVersion: 1, manualSmsEnabled: false,
        primaryAccountId: accountId, primaryNumberId: phoneId,
        approvedPolicyVersion: 1, maxSegments: 5, supportedCountries: ["US"],
        inboundSmsEnabled: false, productionWebhookOrigin: origin,
        voiceRoutingEnabled: true,
        voiceRouting: { ...routing, weeklyHours: hours },
      },
    } });
  }
  beforeAll(async () => {
    for (const k of ["TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID",
      "COMMUNICATION_CONTENT_KEY", "VOICE_MEDIA_ACTIVATION_APPROVED", "VERCEL", "VERCEL_ENV"]) {
      original[k] = process.env[k];
    }
    process.env.TWILIO_AUTH_TOKEN = token;
    process.env.TWILIO_ACCOUNT_SID = acct;
    process.env.COMMUNICATION_CONTENT_KEY = Buffer.alloc(32, 3).toString("base64");
    process.env.VOICE_MEDIA_ACTIVATION_APPROVED = "yes";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { communicationsPolicy: true, communicationsPolicyVersion: true },
    });
    oldPolicy = settings.communicationsPolicy;
    oldVersion = settings.communicationsPolicyVersion;
    await prisma.user.createMany({ data: [
      { id: ownerId, email: "com-l9-owner@example.test", name: "L9 Owner", role: "OWNER", emailVerified: true },
      { id: staffId, email: "com-l9-staff@example.test", name: "L9 Staff", role: "STAFF", emailVerified: true },
    ] });
    await prisma.telecomAccount.create({ data: {
      id: accountId, provider: "twilio", environment: "PRODUCTION",
      externalAccountId: acct, label: "Synthetic COM-L9", status: "READY",
    } });
    await prisma.businessPhoneNumber.create({ data: {
      id: phoneId, accountId, address: number,
      providerNumberId: "synthetic-com-l9-phone", verifiedAt: new Date(),
      registrationStatus: "APPROVED", capabilities: { voice: true, sms: true },
    } });
    await saveRouting([]);
  });
  afterAll(async () => {
    // L7 deliberately prohibits deletion under legal hold: release only our
    // throwaway synthetic fixture's hold before its isolated teardown.
    await prisma.communicationMedia.updateMany({
      where: { session: { accountId } }, data: { legalHold: false },
    });
    await prisma.communicationMedia.deleteMany({ where: {
      session: { accountId },
    } });
    await prisma.providerEvent.deleteMany({ where: { telecomAccountId: accountId } });
    await prisma.callLeg.deleteMany({ where: { accountId } });
    await prisma.callSession.deleteMany({ where: { accountId } });
    await prisma.businessPhoneNumber.deleteMany({ where: { accountId } });
    await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
    await prisma.contactPoint.deleteMany({ where: {
      environment: "PRODUCTION", channel: "SMS", address: caller,
    } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { communicationsPolicy: oldPolicy as object, communicationsPolicyVersion: oldVersion } });
    for (const [k, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    }
  });

  it("denies unsigned recording callback and refuses live record when independent approval is OFF", async () => {
    const form = mediaForm(root, firstRec);
    expect((await mediaRoute(request("/api/webhooks/twilio/voice/media", form, false))).status).toBe(403);
    delete process.env.VOICE_MEDIA_ACTIVATION_APPROVED;
    const denied = await inbound(request("/api/webhooks/twilio/voice", inboundForm(root)));
    expect(await denied.text()).not.toContain("<Record");
    process.env.VOICE_MEDIA_ACTIVATION_APPROVED = "yes";
    expect(await prisma.communicationMedia.count({ where: { session: { accountId } } })).toBe(0);
  });

  it("announces deliberate message, caches completion, imports private bytes once", async () => {
    const call = await inbound(request("/api/webhooks/twilio/voice", inboundForm(second)));
    expect(call.status).toBe(200);
    const prompt = await call.text();
    expect(prompt).toContain("<Record");
    expect(prompt).toContain("recordingStatusCallback=");
    expect(prompt).toContain('transcribe="false"');
    expect(prompt).toContain("After the tone");
    expect(prompt).not.toContain("record-from-answer");

    const finPath = "/api/webhooks/twilio/voice/record-complete";
    const finForm = { AccountSid: acct, CallSid: second, RecordingSid: firstRec };
    const first = await complete(request(finPath, finForm));
    expect(await first.text()).toContain("Thank you");
    const repeat = await complete(request(finPath, finForm));
    expect(await repeat.text()).toContain("Thank you");

    let downloaded = 0;
    const saved: Array<{ key: string; bytes: Buffer }> = [];
    const importer = { download: async () => {
      downloaded += 1;
      return Buffer.from([0x49, 0x44, 0x33, 0x04, 0x01, 0x00]);
    }, store: async (key: string, bytes: Buffer) => { saved.push({ key, bytes }); } };
    const verified = await signedMedia(second, firstRec);
    expect(await ingestVoicemailCallback(verified, importer)).toBe("AVAILABLE");
    expect(await ingestVoicemailCallback(verified, importer)).toBe("AVAILABLE");
    expect(downloaded).toBe(1);
    expect(saved).toHaveLength(1);
    const callSession = await prisma.callSession.findUniqueOrThrow({
      where: { accountId_providerRootCallId: {
        accountId, providerRootCallId: second,
      } },
      include: { media: true },
    });
    expect(callSession.outcome).toBe("VOICEMAIL");
    expect(callSession.media).toHaveLength(1);
    expect(callSession.media[0]?.state).toBe("AVAILABLE");
    expect(saved[0]?.key).toBe(
      `communications/calls/${callSession.id}/${callSession.media[0]?.id}.mp3`);
    expect(callSession.media[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(callSession.media[0]?.retentionUntil).not.toBeNull();

    expect(await getPrivateVoiceMediaForRead(ownerId, callSession.media[0]!.id)).toMatchObject({
      privateStorageKey: saved[0]?.key,
    });
    expect(await getPrivateVoiceMediaForRead(staffId, callSession.media[0]!.id)).toBeNull();
    const inbox = await listMissedCallInbox(ownerId);
    expect(inbox.rows.some(row => row.id === callSession.id && row.outcome === "VOICEMAIL")).toBe(true);
    expect((await listMissedCallInbox(staffId)).rows).toHaveLength(0);
  });

  it("keeps failed provider media in review and allows signed replay to import; denies unmatched media", async () => {
    const made = await inbound(request("/api/webhooks/twilio/voice", inboundForm(third)));
    expect(made.status).toBe(200);
    const stranger = await signedMedia(third, extraRec);
    let attempts = 0;
    const download = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Synthetic provider temporarily unavailable");
      return Buffer.from([0x49, 0x44, 0x33, 0x01]);
    };
    const importer = { download, store: async () => undefined };
    const valid = await signedMedia(third, secondRec);
    await expect(ingestVoicemailCallback(valid, importer)).rejects.toThrow("Synthetic");
    const before = await prisma.communicationMedia.findFirstOrThrow({
      where: { providerResourceId: secondRec },
    });
    expect(before).toMatchObject({ state: "FAILED", privateStorageKey: null });
    expect(await ingestVoicemailCallback(valid, importer)).toBe("AVAILABLE");
    const after = await prisma.communicationMedia.findFirstOrThrow({
      where: { providerResourceId: secondRec },
    });
    expect(after).toMatchObject({ state: "AVAILABLE" });
    expect(attempts).toBe(2);

    const notRecorded = await signedMedia(root, extraRec);
    await expect(ingestVoicemailCallback(notRecorded, importer))
      .rejects.toThrow("lacks matching approved prompt");
    expect(await prisma.communicationMedia.count({ where: { providerResourceId: extraRec } })).toBe(0);

    // The L7 database invariant requires retentionUntil >= createdAt.
    // Backdate this disposable fixture's creation along with its expired deadline.
    await prisma.communicationMedia.update({ where: { id: after.id },
      data: { createdAt: new Date("2019-01-01"),
        retentionUntil: new Date("2020-01-01") } });
    expect(await getPrivateVoiceMediaForRead(ownerId, after.id)).toBeNull();
    await prisma.communicationMedia.update({ where: { id: after.id },
      data: { legalHold: true } });
    expect(await getPrivateVoiceMediaForRead(ownerId, after.id)).not.toBeNull();
  });

  it("offers voicemail after unsuccessful forwarding without labeling staff connected", async () => {
    await saveRouting(Array.from({ length: 7 }, (_, weekday) =>
      ({ weekday, from: "00:00", to: "23:59" })));
    const r = await inbound(request("/api/webhooks/twilio/voice", inboundForm(fourth)));
    expect(await r.text()).toContain("<Dial");
    const response = await dialResult(request("/api/webhooks/twilio/voice/dial-result", {
      AccountSid: acct, CallSid: fourth, DialCallSid: child, DialCallStatus: "no-answer",
      DialBridged: "false",
    }));
    expect(await response.text()).toContain("<Record");
    const call = await prisma.callSession.findUniqueOrThrow({
      where: { accountId_providerRootCallId: {
        accountId, providerRootCallId: fourth,
      } },
    });
    expect(call.state).toBe("CONNECTED");
    expect(call.outcome).toBe("MISSED");
    expect(call.connectedAt).toBeNull();
  });
});
