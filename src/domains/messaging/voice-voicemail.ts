import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import twilio from "twilio";
import { prisma } from "@/lib/prisma";
import { getPrivatePhotoStore } from "@/lib/photo-storage";
import type { Prisma } from "@prisma/client";
import type { VerifiedVoice } from "./voice-webhook-verify";
import { encryptCommunicationContent, decryptCommunicationContent } from "./communications-content";
import type { VoiceRouting } from "./voice-routing";

type Tx = Prisma.TransactionClient;
const recordingSidPattern = /^RE[0-9a-fA-F]{32}$/;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MEDIA_TIMEOUT_MS = 15_000;

export const voiceMediaActivated = () =>
  process.env.VOICE_MEDIA_ACTIVATION_APPROVED === "yes" &&
  ((process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") ||
    (process.env.CI === "true" && (() => {
      try {
        const url = new URL(process.env.DATABASE_URL ?? "");
        return ["localhost", "127.0.0.1"].includes(url.hostname) &&
          url.pathname === "/appliance_desk_test";
      } catch { return false; }
    })()));

export function approvedVoicemailPolicy(
  v: VerifiedVoice, routePolicyVersion: number,
  forMissedCall: boolean,
): NonNullable<VoiceRouting["voicemail"]> | null {
  const route = v.policy.voiceRouting;
  const voicemail = route?.voicemail;
  if (!voiceMediaActivated() || !v.policy.voiceRoutingEnabled ||
      !route || !voicemail?.enabled || routePolicyVersion === 0 ||
      routePolicyVersion !== v.policyVersion ||
      voicemail.approvedPolicyVersion !== v.policyVersion ||
      v.policy.approvedPolicyVersion !== v.policyVersion) return null;
  if (forMissedCall && !voicemail.onMissedCall) return null;
  if (!forMissedCall && route.afterHoursMode !== "VOICEMAIL") return null;
  return voicemail;
}

export function buildVoicemailPrompt(
  origin: string,
  policy: { announcement: string; maxSeconds: number },
): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(policy.announcement);
  response.record({
    action: origin + "/api/webhooks/twilio/voice/record-complete",
    method: "POST",
    maxLength: policy.maxSeconds,
    timeout: 7,
    playBeep: true,
    transcribe: false,
    trim: "trim-silence",
    recordingStatusCallback: origin + "/api/webhooks/twilio/voice/media",
    recordingStatusCallbackMethod: "POST",
    recordingStatusCallbackEvent: ["completed", "absent"],
  });
  return response.toString();
}

export function voicemailFinished(): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say("Thank you. Goodbye.");
  response.hangup();
  return response.toString();
}

/** Called while the parent call transaction holds the account lock. */
export async function recordVoicemailPrompt(
  tx: Tx, v: VerifiedVoice, rootCallSid: string,
  sessionId: string, policy: { maxSeconds: number; retentionDays: number },
) {
  const eventId = `voice:${v.accountId}:${rootCallSid}:voicemail-prompt`;
  await tx.providerEvent.createMany({ data: [{
    provider: "twilio", eventId, type: "voice.voicemail.prompt",
    telecomAccountId: v.accountId, environment: "PRODUCTION",
    disposition: "APPLIED", processedAt: new Date(),
    summary: {
      sessionId, policyVersion: v.policyVersion,
      maxSeconds: policy.maxSeconds, retentionDays: policy.retentionDays,
    },
  }], skipDuplicates: true });
}

/** Deterministic owner-approved completion step. No media availability claim. */
export async function completeVoicemailStep(v: VerifiedVoice): Promise<string> {
  const eventId = `voice:${v.accountId}:${v.callSid}:record-complete`;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "TelecomAccount" WHERE "id" = ${v.accountId} FOR UPDATE`;
    const session = await tx.callSession.findUnique({
      where: { accountId_providerRootCallId: {
        accountId: v.accountId, providerRootCallId: v.callSid,
      } },
      select: { id: true },
    });
    const prompt = await tx.providerEvent.findUnique({
      where: { provider_eventId: {
        provider: "twilio",
        eventId: `voice:${v.accountId}:${v.callSid}:voicemail-prompt`,
      } },
      select: { summary: true, telecomAccountId: true },
    });
    if (!session || !prompt || prompt.telecomAccountId !== v.accountId ||
        (prompt.summary as { sessionId?: string } | null)?.sessionId !== session.id) {
      throw new Error("Voicemail completion is not authorized for this call.");
    }
    const xml = voicemailFinished();
    const inserted = await tx.providerEvent.createMany({ data: [{
      provider: "twilio", eventId, type: "voice.voicemail.complete",
      telecomAccountId: v.accountId, environment: "PRODUCTION",
      disposition: "APPLIED", processedAt: new Date(),
      responseStepKey: "record-complete",
      responseXmlEncrypted: encryptCommunicationContent(xml),
      summary: { sessionId: session.id, step: "record-complete" },
    }], skipDuplicates: true });
    if (inserted.count === 1) return xml;
    const receipt = await tx.providerEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: "twilio", eventId } },
      select: { telecomAccountId: true, responseXmlEncrypted: true },
    });
    if (receipt.telecomAccountId !== v.accountId || !receipt.responseXmlEncrypted)
      throw new Error("Voicemail completion receipt is not replayable.");
    return decryptCommunicationContent(receipt.responseXmlEncrypted);
  });
}

/**
 * HTTPS/API-origin pin prevents RecordingUrl callbacks from determining where
 * server secrets or private audio are fetched. At most one vetted media CDN
 * redirect, never forwarding Basic credentials to the redirect target.
 */
export async function fetchTwilioVoicemail(accountSid: string, recordingSid: string): Promise<Buffer> {
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid) ||
      !recordingSidPattern.test(recordingSid) ||
      accountSid !== process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN) throw new Error("Provider media is not authorized.");
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;
  const auth = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const options = { method: "GET", headers: { authorization: "Basic " + auth },
    redirect: "manual" as const, signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) };
  let response = await fetch(endpoint, options);
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const target = new URL(response.headers.get("location") ?? "", endpoint);
    if (target.protocol !== "https:" || target.username || target.password ||
        target.port || !(
          target.hostname === "twiliocdn.com" ||
          target.hostname.endsWith(".twiliocdn.com") ||
          target.hostname === "twilio.com" ||
          target.hostname.endsWith(".twilio.com")
        )) throw new Error("Untrusted provider media redirect.");
    response = await fetch(target, {
      method: "GET", redirect: "error",
      signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    });
  }
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (response.status !== 200 ||
      (contentType !== "audio/mpeg" && contentType !== "audio/mp3" &&
       contentType !== "application/octet-stream"))
    throw new Error("Provider media not yet available as MP3.");
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_AUDIO_BYTES))
    throw new Error("Voice media size is outside approved bounds.");
  if (!response.body) throw new Error("Missing voice media stream.");
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new Error("Voice media size exceeds approved limit.");
    }
    chunks.push(value);
  }
  if (bytes === 0) throw new Error("Empty provider recording.");
  return Buffer.concat(chunks);
}

async function putVoicemailBytes(key: string, bytes: Buffer): Promise<void> {
  const store = getPrivatePhotoStore();
  if (!store) throw new Error("Approved private media storage is not available.");
  await put(key, new Uint8Array(bytes), {
    token: store.token, access: "private", contentType: "audio/mpeg",
    addRandomSuffix: false, allowOverwrite: false,
    abortSignal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
}

export type MediaImporter = {
  download: (accountSid: string, recordingSid: string) => Promise<Buffer>;
  store: (key: string, bytes: Buffer) => Promise<void>;
};
const defaultImporter: MediaImporter = {
  download: fetchTwilioVoicemail, store: putVoicemailBytes,
};

export async function ingestVoicemailCallback(
  v: VerifiedVoice,
  importer: MediaImporter = defaultImporter,
): Promise<"AVAILABLE" | "FAILED"> {
  if (!voiceMediaActivated()) throw new Error("Voicemail ingestion is not activated.");
  const recordingSid = v.form.get("RecordingSid");
  const status = v.form.get("RecordingStatus");
  const duration = v.form.get("RecordingDuration");
  if (!recordingSid || !recordingSidPattern.test(recordingSid) ||
      v.form.getAll("RecordingSid").length !== 1 ||
      v.form.getAll("RecordingStatus").length !== 1 ||
      !["completed", "failed", "absent"].includes(status ?? "")) {
    throw new Error("Invalid voicemail recording callback.");
  }
  const seconds = duration === null ? null :
    /^\d{1,4}$/.test(duration) ? Number(duration) : NaN;
  if (seconds !== null && (!Number.isInteger(seconds) || seconds > 120)) {
    throw new Error("Unbounded voicemail duration.");
  }
  const eventId = `voice:${v.accountId}:${recordingSid}:media`;
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "TelecomAccount" WHERE "id" = ${v.accountId} FOR UPDATE`;
    const session = await tx.callSession.findUnique({
      where: { accountId_providerRootCallId: {
        accountId: v.accountId, providerRootCallId: v.callSid,
      } },
      select: { id: true, routingPolicyVersion: true },
    });
    if (!session) throw new Error("Voicemail parent call not found.");
    const prompt = await tx.providerEvent.findUnique({
      where: { provider_eventId: {
        provider: "twilio",
        eventId: `voice:${v.accountId}:${v.callSid}:voicemail-prompt`,
      } },
      select: { summary: true, telecomAccountId: true },
    });
    const metadata = prompt?.summary as {
      sessionId?: string; maxSeconds?: number; retentionDays?: number;
      policyVersion?: number;
    } | null;
    if (!prompt || prompt.telecomAccountId !== v.accountId ||
        metadata?.sessionId !== session.id ||
        metadata.policyVersion !== session.routingPolicyVersion ||
        !metadata.maxSeconds || !metadata.retentionDays ||
        (seconds !== null && seconds > metadata.maxSeconds + 2)) {
      throw new Error("Voicemail callback lacks matching approved prompt.");
    }
    const row = await tx.communicationMedia.upsert({ where: {
      callSessionId_kind_providerResourceId: {
        callSessionId: session.id, kind: "VOICEMAIL",
        providerResourceId: recordingSid,
      },
    }, create: {
      callSessionId: session.id, kind: "VOICEMAIL",
      providerResourceId: recordingSid,
      durationSeconds: seconds,
      retentionUntil: new Date(Date.now() + metadata.retentionDays * 86_400_000),
      state: status === "completed" ? "PENDING" : "FAILED",
    }, update: {} });
    await tx.providerEvent.createMany({ data: [{
      provider: "twilio", eventId, type: "voice.media",
      telecomAccountId: v.accountId, environment: "PRODUCTION",
      disposition: "RECEIVED",
      summary: { sessionId: session.id, kind: "VOICEMAIL" },
    }], skipDuplicates: true });
    return { mediaId: row.id, sessionId: session.id,
      state: row.state, maxSeconds: metadata.maxSeconds };
  });
  if (data.state === "AVAILABLE") return "AVAILABLE";
  if (data.state === "DELETED") throw new Error("Deleted voicemail cannot be re-imported.");
  if (status !== "completed") {
    await prisma.providerEvent.update({ where: {
      provider_eventId: { provider: "twilio", eventId },
    }, data: { disposition: "FAILED", processedAt: new Date() } });
    return "FAILED";
  }
  const key = `communications/calls/${data.sessionId}/${data.mediaId}.mp3`;
  try {
    const audio = await importer.download(v.accountSid, recordingSid);
    if (audio.length === 0 || audio.length > MAX_AUDIO_BYTES) throw new Error("Invalid voicemail size.");
    await importer.store(key, audio);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "TelecomAccount" WHERE "id" = ${v.accountId} FOR UPDATE`;
      const media = await tx.communicationMedia.findUniqueOrThrow({ where: { id: data.mediaId } });
      if (media.state === "DELETED" || media.legalHold && media.deletedAt)
        throw new Error("Voicemail storage state changed during import.");
      await tx.communicationMedia.update({ where: { id: data.mediaId }, data: {
        privateStorageKey: key,
        contentHash: createHash("sha256").update(audio).digest("hex"),
        state: "AVAILABLE",
      } });
      await tx.callSession.update({ where: { id: data.sessionId }, data: {
        outcome: "VOICEMAIL", version: { increment: 1 },
      } });
      await tx.providerEvent.update({ where: {
        provider_eventId: { provider: "twilio", eventId },
      }, data: { disposition: "APPLIED", processedAt: new Date() } });
    });
    return "AVAILABLE";
  } catch (error) {
    // A valid retry can reattempt this FAILED/PENDING media. Never claim playable.
    await prisma.communicationMedia.updateMany({ where: {
      id: data.mediaId, state: { not: "AVAILABLE" },
    }, data: { state: "FAILED" } });
    await prisma.providerEvent.updateMany({ where: {
      provider: "twilio", eventId, disposition: { not: "APPLIED" },
    }, data: { disposition: "FAILED", processedAt: new Date() } });
    throw error;
  }
}
