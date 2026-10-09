import { afterAll, beforeAll, describe, expect, it } from "vitest";
import twilio from "twilio";
import { prisma } from "@/lib/prisma";
import { POST as inbound } from "@/app/api/webhooks/twilio/voice/route";
import { POST as accept } from "@/app/api/webhooks/twilio/voice/accept/route";
import { POST as status } from "@/app/api/webhooks/twilio/voice/status/route";
import { POST as dialResult } from "@/app/api/webhooks/twilio/voice/dial-result/route";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const isolated = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(database.hostname) &&
  database.pathname === "/appliance_desk_test";
const origin = "https://voice.example.test";
const token = "synthetic-voice-webhook-test-only";
const accountSid = "AC" + "a".repeat(32);
const accountId = "com-l8-account";
const numberId = "com-l8-number";
const number = "+13035551981";
const caller = "+13035551982";
const destination = "+13035551983";
const root = "CA" + "1".repeat(32);
const child = "CA" + "2".repeat(32);
const secondRoot = "CA" + "3".repeat(32);
const secondChild = "CA" + "4".repeat(32);
const routePolicy = {
  timezone: "America/Denver", forwardTo: destination,
  destinationVerifiedAt: "2026-01-01T00:00:00Z",
  destinationApprovedAt: "2026-01-01T00:00:00Z",
  timeoutSeconds: 20,
  weeklyHours: Array.from({ length: 7 }, (_, weekday) =>
    ({ weekday, from: "00:00", to: "23:59" })),
  closedDates: [], afterHoursMode: "CLOSED",
  greeting: "We are closed.", unavailableGreeting: "We cannot answer.",
};

function signedRequest(path: string, params: Record<string, string>, signed = true) {
  const url = origin + path;
  const body = new URLSearchParams(params).toString();
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(signed ? { "x-twilio-signature":
        twilio.getExpectedTwilioSignature(token, url, params) } : {}),
    },
    body,
  });
}
function base(callSid: string) {
  return { AccountSid: accountSid, CallSid: callSid };
}

describe.skipIf(!isolated)("COM-L8 signed voice/leg callbacks on throwaway Postgres", () => {
  const old: Record<string, string | undefined> = {};
  let oldPolicy: unknown;
  let oldVersion = 0;
  beforeAll(async () => {
    for (const key of ["TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID",
      "COMMUNICATION_CONTENT_KEY", "VERCEL", "VERCEL_ENV"]) old[key] = process.env[key];
    process.env.TWILIO_AUTH_TOKEN = token;
    process.env.TWILIO_ACCOUNT_SID = accountSid;
    process.env.COMMUNICATION_CONTENT_KEY = Buffer.alloc(32, 9).toString("base64");
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { communicationsPolicy: true, communicationsPolicyVersion: true },
    });
    oldPolicy = settings.communicationsPolicy;
    oldVersion = settings.communicationsPolicyVersion;
    await prisma.telecomAccount.create({ data: {
      id: accountId, provider: "twilio", environment: "PRODUCTION",
      externalAccountId: accountSid, label: "synthetic COM-L8", status: "READY",
    } });
    await prisma.businessPhoneNumber.create({ data: {
      id: numberId, accountId, address: number,
      providerNumberId: "synthetic-com-l8-number", verifiedAt: new Date(),
      registrationStatus: "APPROVED", capabilities: { sms: true, voice: true },
    } });
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: {
        communicationsPolicyVersion: oldVersion,
        communicationsPolicy: {
          schemaVersion: 1, manualSmsEnabled: false,
          primaryAccountId: accountId, primaryNumberId: numberId,
          approvedPolicyVersion: oldVersion, maxSegments: 5,
          supportedCountries: ["US"], inboundSmsEnabled: false,
          productionWebhookOrigin: origin,
          voiceRoutingEnabled: true, voiceRouting: routePolicy,
        },
      },
    });
  });
  afterAll(async () => {
    await prisma.providerEvent.deleteMany({ where: { telecomAccountId: accountId } });
    await prisma.callLeg.deleteMany({ where: { accountId } });
    await prisma.callSession.deleteMany({ where: { accountId } });
    await prisma.businessPhoneNumber.deleteMany({ where: { accountId } });
    await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
    await prisma.contactPoint.deleteMany({
      where: { environment: "PRODUCTION", channel: "SMS", address: caller },
    });
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { communicationsPolicyVersion: oldVersion,
        communicationsPolicy: oldPolicy as object },
    });
    for (const [name, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("rejects unsigned traffic and signed traffic from the wrong account", async () => {
    expect((await inbound(signedRequest("/api/webhooks/twilio/voice",
      { ...base(root), From: caller, To: number }, false))).status).toBe(403);
    expect((await inbound(signedRequest("/api/webhooks/twilio/voice",
      { ...base(root), AccountSid: "AC" + "f".repeat(32), From: caller, To: number }))).status).toBe(403);
    expect(await prisma.callSession.count({ where: { accountId } })).toBe(0);
  });

  it("persists TwiML, private press-1 acceptance and a single child leg under replay", async () => {
    const path = "/api/webhooks/twilio/voice";
    const params = { ...base(root), From: caller, To: number };
    const first = await inbound(signedRequest(path, params));
    expect(first.status).toBe(200);
    const xml = await first.text();
    expect(xml).toContain("<Dial");
    expect(xml).toContain("do-not-record");
    expect(xml).toContain("/voice/accept");
    expect(xml).not.toContain("<Record");
    const same = await inbound(signedRequest(path, params));
    expect(await same.text()).toBe(xml);
    expect(await prisma.callSession.count({ where: { accountId } })).toBe(1);

    const acceptPath = "/api/webhooks/twilio/voice/accept";
    const callback = { ...base(child), ParentCallSid: root };
    const prompt = await accept(signedRequest(acceptPath, callback));
    expect(await prompt.text()).toContain("Press 1");
    const decisionPath = acceptPath + "?step=decision";
    const accepted = await accept(signedRequest(decisionPath, { ...callback, Digits: "1" }));
    expect(await accepted.text()).toContain("Connecting your call");
    const repeat = await accept(signedRequest(decisionPath, { ...callback, Digits: "2" }));
    expect(await repeat.text()).toContain("Connecting your call");
    const result = await dialResult(signedRequest("/api/webhooks/twilio/voice/dial-result", {
      ...base(root), DialCallSid: child, DialCallStatus: "completed",
      DialBridged: "true", DialCallDuration: "45",
    }));
    expect(result.status).toBe(200);
    const session = await prisma.callSession.findUniqueOrThrow({
      where: { accountId_providerRootCallId: { accountId, providerRootCallId: root } },
      include: { legs: true },
    });
    expect(session.outcome).toBe("ANSWERED");
    expect(session.legs).toHaveLength(2);
    expect(session.legs.find((leg) => leg.role === "FORWARD")?.answeredByStaffAt).not.toBeNull();
  });

  it("holds early child status, drains it on ingress, and never regresses a terminal leg", async () => {
    const path = "/api/webhooks/twilio/voice/status";
    const early = { ...base(secondChild), ParentCallSid: secondRoot,
      CallStatus: "completed", SequenceNumber: "4", CallDuration: "18" };
    expect((await status(signedRequest(path, early))).status).toBe(204);
    const pending = await prisma.providerEvent.findFirstOrThrow({
      where: { telecomAccountId: accountId, type: "voice.status",
        disposition: "PENDING_MATCH" },
    });
    expect(pending).toBeTruthy();
    expect((await inbound(signedRequest("/api/webhooks/twilio/voice", {
      ...base(secondRoot), From: caller, To: number,
    }))).status).toBe(200);
    expect((await prisma.providerEvent.findUniqueOrThrow({ where: { id: pending.id } }))
      .disposition).toBe("APPLIED");
    const late = { ...early, CallStatus: "ringing", SequenceNumber: "1" };
    expect((await status(signedRequest(path, late))).status).toBe(204);
    const leg = await prisma.callLeg.findUniqueOrThrow({
      where: { accountId_providerCallId: { accountId, providerCallId: secondChild } },
    });
    expect(leg.status).toBe("COMPLETED");
    expect(leg.durationSeconds).toBe(18);

    const dial = await dialResult(signedRequest("/api/webhooks/twilio/voice/dial-result", {
      ...base(secondRoot), DialCallSid: secondChild,
      DialCallStatus: "no-answer", DialBridged: "false",
    }));
    expect(dial.status).toBe(200);
    const session = await prisma.callSession.findUniqueOrThrow({
      where: { accountId_providerRootCallId: {
        accountId, providerRootCallId: secondRoot,
      } },
    });
    expect(session.outcome).toBe("MISSED");
    expect(session.connectedAt).toBeNull();
  });
});
