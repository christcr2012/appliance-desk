import twilio from "twilio";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { decryptCommunicationContent, encryptCommunicationContent } from "./communications-content";
import { decideVoiceRoute, DEFAULT_VOICE_UNAVAILABLE } from "./voice-routing";
import type { VerifiedVoice } from "./voice-webhook-verify";

type Tx = Prisma.TransactionClient;
const terminal = new Set(["COMPLETED", "BUSY", "NO_ANSWER", "CANCELED", "FAILED"]);
const sid = /^CA[0-9a-fA-F]{32}$/;

function speech(text: string): string {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say(text);
  twiml.hangup();
  return twiml.toString();
}
function hangup(): string {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.hangup();
  return twiml.toString();
}
function gatherXml(origin: string): string {
  const twiml = new twilio.twiml.VoiceResponse();
  const gather = twiml.gather({
    input: ["dtmf"], numDigits: 1, timeout: 5,
    actionOnEmptyResult: true, method: "POST",
    action: origin + "/api/webhooks/twilio/voice/accept?step=decision",
  });
  gather.say("Press 1 to accept this business call.");
  twiml.hangup();
  return twiml.toString();
}
function dialXml(origin: string, businessNumber: string, destination: string, seconds: number) {
  const twiml = new twilio.twiml.VoiceResponse();
  const dial = twiml.dial({
    answerOnBridge: true, timeout: seconds, record: "do-not-record",
    callerId: businessNumber, method: "POST",
    action: origin + "/api/webhooks/twilio/voice/dial-result",
  });
  dial.number({
    url: origin + "/api/webhooks/twilio/voice/accept", method: "POST",
    statusCallback: origin + "/api/webhooks/twilio/voice/status",
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  }, destination);
  return twiml.toString();
}
function key(v: VerifiedVoice, step: string, resource: string) {
  return `voice:${v.accountId}:${resource}:${step}`;
}

/** Serialize a call's mutation against concurrent callback steps in one account. */
async function lockAccount(tx: Tx, accountId: string) {
  await tx.$queryRaw`SELECT "id" FROM "TelecomAccount" WHERE "id" = ${accountId} FOR UPDATE`;
}
async function storeTwiML(
  tx: Tx, v: VerifiedVoice, eventId: string, step: string, xml: string,
): Promise<{ xml: string; fresh: boolean }> {
  const inserted = await tx.providerEvent.createMany({ data: [{
    provider: "twilio", eventId, type: "voice." + step,
    telecomAccountId: v.accountId, environment: "PRODUCTION",
    disposition: "APPLIED", receivedAt: new Date(), processedAt: new Date(),
    responseStepKey: step, responseXmlEncrypted: encryptCommunicationContent(xml),
    summary: { step },
  }], skipDuplicates: true });
  if (inserted.count === 1) return { xml, fresh: true };
  const existing = await tx.providerEvent.findUnique({ where: {
    provider_eventId: { provider: "twilio", eventId },
  }, select: { responseXmlEncrypted: true, telecomAccountId: true } });
  if (!existing || existing.telecomAccountId !== v.accountId || !existing.responseXmlEncrypted) {
    throw new Error("Voice response replay is unavailable.");
  }
  return { xml: decryptCommunicationContent(existing.responseXmlEncrypted), fresh: false };
}

export async function incomingVoice(v: VerifiedVoice): Promise<string> {
  const from = v.form.get("From") ?? "";
  const to = v.form.get("To") ?? "";
  if (!from || !to || v.form.getAll("From").length !== 1 ||
      v.form.getAll("To").length !== 1) throw new Error("Invalid voice identity.");
  return prisma.$transaction(async (tx) => {
    await lockAccount(tx, v.accountId);
    const account = await tx.telecomAccount.findUniqueOrThrow({
      where: { id: v.accountId }, select: { status: true },
    });
    const number = await tx.businessPhoneNumber.findFirst({
      where: { accountId: v.accountId, address: to, retiredAt: null },
      select: { id: true, verifiedAt: true, capabilities: true, registrationStatus: true },
    });
    if (!number) throw new Error("Unknown receiving business number.");
    const readyNumber = number.verifiedAt !== null &&
      (number.capabilities as { voice?: unknown } | null)?.voice === true;
    const route = decideVoiceRoute({
      enabled: v.policy.voiceRoutingEnabled === true &&
        v.policy.primaryAccountId === v.accountId &&
        v.policy.primaryNumberId === number.id,
      approvedVersion: v.policy.approvedPolicyVersion, policyVersion: v.policyVersion,
      routing: v.policy.voiceRouting,
      accountReady: account.status === "READY", numberReady: readyNumber,
      callerNumber: from, businessNumber: to, now: new Date(),
    });
    const xml = route.kind === "DIAL"
      ? dialXml(v.canonicalOrigin, to, route.destination, route.timeoutSeconds)
      : speech(route.greeting);
    const event = await storeTwiML(tx, v, key(v, "inbound", v.callSid), "inbound", xml);
    if (!event.fresh) return event.xml;

    const contactPoint = /^\+[1-9][0-9]{5,14}$/.test(from)
      ? await tx.contactPoint.upsert({
        where: { environment_channel_address: {
          environment: "PRODUCTION", channel: "SMS", address: from,
        } },
        create: { environment: "PRODUCTION", channel: "SMS", address: from },
        update: {},
        select: { id: true },
      }) : null;
    const startedAt = new Date();
    const session = await tx.callSession.create({ data: {
      startedAt,
      accountId: v.accountId, businessNumberId: number.id,
      providerRootCallId: v.callSid, direction: "INBOUND",
      contactPointId: contactPoint?.id ?? null,
      routingPolicyVersion: route.kind === "DIAL" ? v.policyVersion : 0,
      state: route.kind === "DIAL" ? "RINGING" : "ENDED",
      outcome: route.kind === "DIAL" ? null : "MISSED",
      endedAt: route.kind === "DIAL" ? null : startedAt,
    } });
    await tx.callLeg.create({ data: {
      accountId: v.accountId, callSessionId: session.id, providerCallId: v.callSid,
      role: "INBOUND", status: route.kind === "DIAL" ? "RINGING" : "COMPLETED",
      startedAt, endedAt: route.kind === "DIAL" ? null : startedAt,
    } });
    // Twilio may deliver a child status before its inbound request; consume
    // the durable pending receipt now rather than silently dropping it.
    const pending = await tx.providerEvent.findMany({
      where: { provider: "twilio", telecomAccountId: v.accountId,
        type: "voice.status", disposition: "PENDING_MATCH",
        OR: [
          { summary: { path: ["parentSid"], equals: v.callSid } },
          { summary: { path: ["callSid"], equals: v.callSid } },
        ],
      }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }], take: 50,
      select: { eventId: true, summary: true },
    });
    for (const item of pending) {
      const parsed = item.summary as StatusSummary | null;
      if (parsed && typeof parsed.callSid === "string" &&
          typeof parsed.state === "string") {
        await applyStatus(tx, v, item.eventId, parsed);
      }
    }
    return event.xml;
  });
}

async function getSession(tx: Tx, v: VerifiedVoice, rootSid: string) {
  return tx.callSession.findUnique({
    where: { accountId_providerRootCallId: {
      accountId: v.accountId, providerRootCallId: rootSid,
    } },
  });
}

/** Child whisper is never an answered call until the staff member presses 1. */
export async function acceptVoiceStep(v: VerifiedVoice, step: "prompt" | "decision") {
  const parentSid = v.form.get("ParentCallSid");
  if (!parentSid || !sid.test(parentSid)) throw new Error("Uncorrelated call.");
  return prisma.$transaction(async (tx) => {
    await lockAccount(tx, v.accountId);
    const session = await getSession(tx, v, parentSid);
    if (!session || session.routingPolicyVersion < 1) throw new Error("No authorized forwarding call.");
    const approved = step === "decision" && v.form.get("Digits") === "1";
    const xml = step === "prompt" ? gatherXml(v.canonicalOrigin)
      : approved ? (() => {
        const response = new twilio.twiml.VoiceResponse();
        response.say("Connecting your call.");
        return response.toString();
      })() : hangup();
    const event = await storeTwiML(tx, v, key(v, step, v.callSid), "accept." + step, xml);
    if (!event.fresh) return event.xml;
    if (step === "decision" && approved) {
      const leg = await tx.callLeg.upsert({
        where: { accountId_providerCallId: {
          accountId: v.accountId, providerCallId: v.callSid,
        } },
        create: { accountId: v.accountId, callSessionId: session.id,
          providerCallId: v.callSid, providerParentCallId: parentSid,
          role: "FORWARD", status: "IN_PROGRESS", answeredByStaffAt: new Date() },
        update: { answeredByStaffAt: new Date() },
      });
      // Dial-result may arrive before accept; only the bridge callback proves
      // the accepted leg was actually connected to the caller.
      const priorResult = await tx.providerEvent.findFirst({
        where: { provider: "twilio", eventId: key(v, "dial-result", parentSid),
          telecomAccountId: v.accountId },
        select: { summary: true },
      });
      const summary = priorResult?.summary as { bridged?: boolean; childSid?: string } | null;
      if (summary?.bridged === true && summary.childSid === leg.providerCallId) {
        const connectedAt = new Date(Math.min(
          Math.max(leg.answeredByStaffAt!.getTime(), session.startedAt.getTime()),
          session.endedAt?.getTime() ?? Date.now(),
        ));
        await tx.callSession.update({ where: { id: session.id },
          data: { outcome: "ANSWERED", connectedAt,
            version: { increment: 1 } },
        });
      }
    }
    return event.xml;
  });
}

const statuses: Record<string, "QUEUED" | "RINGING" | "IN_PROGRESS" | "COMPLETED" | "BUSY" | "NO_ANSWER" | "CANCELED" | "FAILED"> = {
  queued: "QUEUED", initiated: "QUEUED", ringing: "RINGING",
  "in-progress": "IN_PROGRESS", answered: "IN_PROGRESS",
  completed: "COMPLETED", busy: "BUSY", "no-answer": "NO_ANSWER",
  canceled: "CANCELED", failed: "FAILED",
};
function countOrNull(value: string | null, max: number) {
  if (value === null) return null;
  if (!/^\d{1,10}$/.test(value)) throw new Error("Invalid voice event counter.");
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num > max) throw new Error("Invalid voice event counter.");
  return num;
}

type StatusSummary = {
  callSid: string;
  parentSid: string | null;
  state: string;
  seq: number | null;
  seconds: number | null;
};
const rank: Record<string, number> = { QUEUED: 1, RINGING: 2, IN_PROGRESS: 3 };

async function applyStatus(
  tx: Tx, v: VerifiedVoice, eventId: string, summary: StatusSummary,
): Promise<boolean> {
  const state = summary.state as "QUEUED" | "RINGING" | "IN_PROGRESS" |
    "COMPLETED" | "BUSY" | "NO_ANSWER" | "CANCELED" | "FAILED";
  if (!Object.values(statuses).includes(state)) return false;
  const session = await getSession(tx, v, summary.parentSid ?? summary.callSid);
  if (!session) return false;
  const leg = await tx.callLeg.findUnique({
    where: { accountId_providerCallId: {
      accountId: v.accountId, providerCallId: summary.callSid,
    } },
  });
  if (!leg) {
    const at = new Date();
    await tx.callLeg.create({ data: {
      startedAt: at,
      accountId: v.accountId, callSessionId: session.id,
      providerCallId: summary.callSid, providerParentCallId: summary.parentSid,
      role: summary.parentSid ? "FORWARD" : "INBOUND",
      status: state, sequenceNumber: summary.seq,
      durationSeconds: summary.seconds,
      endedAt: terminal.has(state) ? at : null,
    } });
  } else if (leg.callSessionId !== session.id) {
    throw new Error("Voice leg belongs to a different call.");
  } else if (!(summary.seq !== null && leg.sequenceNumber !== null &&
        summary.seq <= leg.sequenceNumber) &&
      !terminal.has(leg.status) &&
      (terminal.has(state) ||
        (rank[state] ?? 0) >= (rank[leg.status] ?? 0))) {
    await tx.callLeg.update({ where: { id: leg.id }, data: {
      status: state, sequenceNumber: summary.seq ?? leg.sequenceNumber,
      durationSeconds: summary.seconds ?? leg.durationSeconds,
      endedAt: terminal.has(state)
        ? new Date(Math.max(Date.now(), leg.startedAt.getTime())) : null,
    } });
  }
  if (!summary.parentSid && terminal.has(state) && session.state !== "ENDED") {
    await tx.callSession.update({ where: { id: session.id }, data: {
      state: "ENDED", endedAt: new Date(Math.max(Date.now(),
        session.startedAt.getTime(), session.connectedAt?.getTime() ?? 0)),
      outcome: session.outcome ?? "MISSED", version: { increment: 1 },
    } });
  }
  await tx.providerEvent.update({ where: {
    provider_eventId: { provider: "twilio", eventId },
  }, data: { disposition: "APPLIED", processedAt: new Date() } });
  return true;
}

/** Signed Twilio callbacks may arrive out of order; receipts are durable. */
export async function voiceStatus(v: VerifiedVoice): Promise<void> {
  const state = statuses[v.form.get("CallStatus") ?? ""];
  if (!state) throw new Error("Unsupported voice call status.");
  const parentSid = v.form.get("ParentCallSid");
  const seq = countOrNull(v.form.get("SequenceNumber"), 2147483647);
  const seconds = countOrNull(v.form.get("CallDuration"), 31536000);
  const summary: StatusSummary = { callSid: v.callSid, parentSid, state, seq, seconds };
  const id = key(v, "status", `${v.callSid}:${seq ?? state}`);
  await prisma.$transaction(async (tx) => {
    await lockAccount(tx, v.accountId);
    const stored = await tx.providerEvent.createMany({ data: [{
      provider: "twilio", eventId: id, type: "voice.status",
      telecomAccountId: v.accountId, environment: "PRODUCTION",
      disposition: "PENDING_MATCH", summary,
    }], skipDuplicates: true });
    if (stored.count === 0) return;
    await applyStatus(tx, v, id, summary);
  });
}

export async function dialResult(v: VerifiedVoice): Promise<string> {
  const childSid = v.form.get("DialCallSid");
  const dialStatus = v.form.get("DialCallStatus");
  if (!childSid || !sid.test(childSid) || !dialStatus ||
      !statuses[dialStatus]) throw new Error("Invalid forward result.");
  const seconds = countOrNull(v.form.get("DialCallDuration"), 31536000);
  const bridged = v.form.get("DialBridged") === "true";
  return prisma.$transaction(async (tx) => {
    await lockAccount(tx, v.accountId);
    const session = await getSession(tx, v, v.callSid);
    if (!session || session.routingPolicyVersion < 1) throw new Error("Unknown forwarded call.");
    const eventId = key(v, "dial-result", v.callSid);
    const existingLeg = await tx.callLeg.findUnique({
      where: { accountId_providerCallId: {
        accountId: v.accountId, providerCallId: childSid,
      } }, select: { answeredByStaffAt: true, callSessionId: true, startedAt: true,
        status: true },
    });
    if (existingLeg && existingLeg.callSessionId !== session.id) {
      throw new Error("Cross-call leg collision.");
    }
    const response = await storeTwiML(tx, v, eventId, "dial-result",
      bridged ? hangup() : speech(DEFAULT_VOICE_UNAVAILABLE));
    if (!response.fresh) return response.xml;
    const at = new Date(Math.max(Date.now(), existingLeg?.startedAt.getTime() ?? 0));
    const conflict = !!existingLeg && terminal.has(existingLeg.status) &&
      existingLeg.status !== statuses[dialStatus];
    const leg = await tx.callLeg.upsert({ where: {
      accountId_providerCallId: { accountId: v.accountId, providerCallId: childSid },
    }, create: {
      accountId: v.accountId, callSessionId: session.id, providerCallId: childSid,
      providerParentCallId: v.callSid, role: "FORWARD",
      status: statuses[dialStatus], durationSeconds: seconds,
      startedAt: at, endedAt: at,
    }, update: { status: conflict ? existingLeg!.status : statuses[dialStatus],
      durationSeconds: seconds, endedAt: at } });
    if (leg.callSessionId !== session.id) throw new Error("Cross-call leg collision.");
    const answered = bridged && dialStatus === "completed" &&
      leg.answeredByStaffAt !== null;
    const pending = bridged && dialStatus === "completed" && !answered;
    await tx.callSession.update({ where: { id: session.id }, data: {
      state: "ENDED", endedAt: new Date(Math.max(Date.now(),
        session.startedAt.getTime(), leg.answeredByStaffAt?.getTime() ?? 0)),
      outcome: conflict ? "UNKNOWN" : answered ? "ANSWERED" : pending ? "UNKNOWN" : "MISSED",
      connectedAt: answered ? leg.answeredByStaffAt : null,
      version: { increment: 1 },
    } });
    await tx.providerEvent.update({ where: {
      provider_eventId: { provider: "twilio", eventId },
    }, data: { summary: { step: "dial-result", bridged, childSid,
      status: dialStatus, conflict }, processedAt: new Date() } });
    return response.xml;
  });
}
