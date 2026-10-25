import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { normalizeSmsAddress } from "./suppression";
import { loadCallSubject } from "./workflow-text-subjects";
import { ensureContact, ensureThread, loadSendContext, maskPhone } from "./workflow-text";
import { isLiveTelecomDeployment } from "./dispatch-communication";
import { makeTwilioVoiceProvider, makeTwilioSmsProvider } from "@/lib/communications/providers/twilio-sms";
import { settlePendingVoiceStatuses } from "./voice-webhooks";
import type { TelecomVoiceProvider } from "@/lib/communications/providers/types";

/**
 * COM-N2 click-to-call. The carrier rings the staff member's own confirmed phone first; the customer is dialed only after
 * the staff member answers and presses 1. The business number is the caller ID. Off until the Owner switches it on.
 */
export type CallSubject = { type: "Job" | "Lead" | "MaintenanceRequest"; id: string };

export type CallPreview =
  | { available: true; customerName: string; customerPhoneMasked: string; staffPhoneMasked: string; businessNumberMasked: string }
  | { available: false; reason: string };

type Deps = { provider?: TelecomVoiceProvider; callbackOrigin?: string; now?: Date };
const IN_FLIGHT_MS = 5 * 60_000;

function disposableHarness(): boolean {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
  } catch { return false; }
}

type Checked =
  | { ok: false; reason: string }
  | { ok: true; staffPhone: string; customerPhone: string; customerName: string; subject: NonNullable<Awaited<ReturnType<typeof loadCallSubject>>>;
      ctx: Awaited<ReturnType<typeof loadSendContext>> & { account: NonNullable<Awaited<ReturnType<typeof loadSendContext>>["account"]>; policy: NonNullable<Awaited<ReturnType<typeof loadSendContext>>["policy"]> };
      actorRole: string };

const NOT_ALLOWED = "You can only call customers on visits assigned to you.";

async function check(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], actorId: string, call: CallSubject, now: Date): Promise<Checked> {
  const actor = await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN", "STAFF"]);
  const role = (actor as { role: string }).role;
  const ctx = await loadSendContext(tx);
  if (!ctx.policy || !ctx.account || ctx.policy.voiceRoutingEnabled !== true || ctx.policy.clickToCallEnabled !== true ||
      ctx.policy.approvedPolicyVersion !== ctx.policyVersion) return { ok: false, reason: "Calling from the desk is switched off." };
  const account = ctx.account;
  if (account.status !== "READY" || !account.number.verifiedAt || account.number.retiredAt ||
      (account.number.capabilities as { voice?: unknown } | null)?.voice !== true) {
    return { ok: false, reason: "The business phone number is not ready for calls." };
  }
  const subject = await loadCallSubject(tx, call.type, call.id, now);
  if (!subject) return { ok: false, reason: "That record was not found." };
  if (role === "STAFF") {
    const job = call.type === "Job" ? await tx.job.findUnique({ where: { id: call.id }, select: { status: true } }) : null;
    if (call.type !== "Job" || subject.assigneeUserId !== actorId || !job || (job.status !== "SCHEDULED" && job.status !== "IN_PROGRESS")) {
      return { ok: false, reason: NOT_ALLOWED };
    }
  }
  const user = await tx.user.findUnique({ where: { id: actorId }, select: { phone: true, phoneConfirmedAt: true } });
  if (!user?.phone || !user.phoneConfirmedAt) return { ok: false, reason: "Confirm your own mobile number in My account first." };
  let staffPhone: string;
  try { staffPhone = normalizeSmsAddress(user.phone); } catch { return { ok: false, reason: "Your saved mobile number is not usable." }; }
  if (!subject.phone) return { ok: false, reason: "This customer has no usable phone number saved." };
  if (subject.phone === staffPhone || subject.phone === account.number.address) {
    return { ok: false, reason: "The customer's number matches a business or staff number." };
  }
  const recent = await tx.callSession.findFirst({ where: { accountId: account.id, actorUserId: actorId, direction: "OUTBOUND",
    startedAt: { gt: new Date(now.getTime() - IN_FLIGHT_MS) }, OR: [{ state: { in: ["NEW", "RINGING", "CONNECTED"] } }, { outcome: "UNKNOWN" }] },
    select: { id: true } });
  if (recent) return { ok: false, reason: "A call from you is already in progress or unconfirmed. Wait a few minutes." };
  return { ok: true, staffPhone, customerPhone: subject.phone, customerName: subject.displayName, subject, ctx: { ...ctx, account, policy: ctx.policy }, actorRole: role };
}

export async function getClickToCallPreview(actorId: string, call: CallSubject, now = new Date()): Promise<CallPreview> {
  return prisma.$transaction(async (tx) => {
    const result = await check(tx, actorId, call, now);
    if (!result.ok) return { available: false, reason: result.reason };
    return { available: true, customerName: result.customerName, customerPhoneMasked: maskPhone(result.customerPhone),
      staffPhoneMasked: maskPhone(result.staffPhone), businessNumberMasked: maskPhone(result.ctx.account.number.address) };
  });
}

export type StartCallResult =
  | { status: "STARTED"; sessionId: string }
  | { status: "NOT_STARTED"; reason: string }
  | { status: "UNCONFIRMED"; sessionId: string };

export async function startClickToCall(
  actorId: string, input: { subject: CallSubject; clientToken: string }, deps: Deps = {},
): Promise<StartCallResult> {
  const now = deps.now ?? new Date();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.clientToken)) return { status: "NOT_STARTED", reason: "Reload the page and try again." };
  const rootKey = `pending:${actorId}:${input.clientToken}`;
  const prepared = await prisma.$transaction(async (tx) => {
    // First look only to find the phone account, take its lock, then look again: two taps at the same moment
    // must queue up here so the second one sees the first call and is refused.
    const first = await check(tx, actorId, input.subject, now);
    if (first.ok) await tx.$queryRaw`SELECT "id" FROM "TelecomAccount" WHERE "id" = ${first.ctx.account.id} FOR UPDATE`;
    const earlier = await tx.auditLog.findFirst({ where: { action: "COMMUNICATION_CALL_STARTED", userId: actorId,
      newValue: { path: ["clientToken"], equals: input.clientToken } }, select: { newValue: true, entityType: true, entityId: true } });
    const earlierId = (earlier?.newValue as { callSessionId?: string } | null)?.callSessionId;
    const existing = earlierId ? await tx.callSession.findUnique({ where: { id: earlierId }, select: { id: true, state: true } }) : null;
    if (existing) {
      // A token only ever repeats the same call on the same record, and only while that call is still live.
      if (earlier?.entityType !== input.subject.type || earlier.entityId !== input.subject.id) return { refused: "Reload the page and try again." } as const;
      return { replay: existing } as const;
    }
    const c = await check(tx, actorId, input.subject, now);
    if (!c.ok) return { refused: c.reason } as const;
    const { pointId } = await ensureContact(tx, actorId, c.ctx, c.subject, now);
    const thread = await ensureThread(tx, c.ctx, c.subject, pointId, now);
    const session = await tx.callSession.create({ data: { accountId: c.ctx.account.id, businessNumberId: c.ctx.account.number.id,
      contactPointId: pointId, threadId: thread.id, direction: "OUTBOUND", providerRootCallId: rootKey, actorUserId: actorId,
      routingPolicyVersion: c.ctx.policyVersion, state: "NEW", startedAt: now } });
    await tx.auditLog.create({ data: { userId: actorId, action: "COMMUNICATION_CALL_STARTED", entityType: input.subject.type,
      entityId: input.subject.id, newValue: { callSessionId: session.id, clientToken: input.clientToken } } });
    return { session, c } as const;
  });
  if ("refused" in prepared) return { status: "NOT_STARTED", reason: prepared.refused as string };
  if ("replay" in prepared && prepared.replay) {
    const r = prepared.replay;
    if (r.state === "FAILED") return { status: "NOT_STARTED", reason: "That call did not go through." };
    if (r.state === "ENDED") return { status: "NOT_STARTED", reason: "That call already finished. Reload the page to start a new one." };
    return { status: "STARTED", sessionId: r.id };
  }
  if (!("session" in prepared) || !prepared.session) return { status: "NOT_STARTED", reason: "Calling is not available right now." };
  const { session, c } = prepared;
  const account = c.ctx.account;

  // Choose the carrier connection. A fake is allowed only in the disposable test harness against a TEST account.
  let provider: TelecomVoiceProvider | null = null;
  let origin: string | undefined;
  if (disposableHarness() && account.environment === "TEST") { provider = deps.provider ?? null; origin = deps.callbackOrigin; }
  else if (isLiveTelecomDeployment() && account.environment === "PRODUCTION" && c.ctx.policy.productionWebhookOrigin) {
    const lookup = makeTwilioSmsProvider(account.externalAccountId);
    const bothUs = lookup?.verifyUsDestination
      ? (await lookup.verifyUsDestination(c.customerPhone)) && (await lookup.verifyUsDestination(c.staffPhone)) : false;
    if (bothUs) { provider = makeTwilioVoiceProvider(account.externalAccountId); origin = c.ctx.policy.productionWebhookOrigin; }
  }
  let urls: { url: string; statusCallback: string } | null = null;
  try {
    if (origin) {
      const u = new URL("/api/webhooks/twilio/voice/click-to-call", origin);
      u.searchParams.set("op", session.id);
      const s = new URL("/api/webhooks/twilio/voice/status", origin);
      if (u.protocol === "https:" && !u.username && !u.password && !u.hostname.includes("_")) urls = { url: u.toString(), statusCallback: s.toString() };
    }
  } catch { /* invalid origin: nothing is sent */ }

  let outcome: Awaited<ReturnType<TelecomVoiceProvider["createCall"]>> = { kind: "NOT_ATTEMPTED", reason: "PROVIDER_NOT_CONFIGURED" };
  if (provider && urls) {
    try {
      outcome = await provider.createCall({ operationId: session.id, from: account.number.address, to: c.staffPhone, ...urls });
    } catch { outcome = { kind: "UNKNOWN" }; }
  }

  return prisma.$transaction(async (tx) => {
    const fresh = await tx.callSession.findUniqueOrThrow({ where: { id: session.id } });
    if (outcome.kind === "ACCEPTED") {
      // The carrier may already have asked what to do (and bound its own id); never overwrite a real id.
      if (fresh.providerRootCallId.startsWith("pending:")) {
        await tx.callSession.update({ where: { id: session.id }, data: { providerRootCallId: outcome.resourceId,
          state: fresh.state === "NEW" ? "RINGING" : fresh.state, version: { increment: 1 } } });
        await tx.callLeg.upsert({ where: { accountId_providerCallId: { accountId: account.id, providerCallId: outcome.resourceId } },
          create: { accountId: account.id, callSessionId: session.id, providerCallId: outcome.resourceId, role: "STAFF", status: "QUEUED", startedAt: now },
          update: {} });
      }
      await settlePendingVoiceStatuses(tx, account.id, outcome.resourceId);
      return { status: "STARTED", sessionId: session.id } as const;
    }
    if (outcome.kind === "UNKNOWN") {
      await tx.callSession.update({ where: { id: session.id }, data: { state: "FAILED", outcome: "UNKNOWN", endedAt: new Date(), version: { increment: 1 } } });
      return { status: "UNCONFIRMED", sessionId: session.id } as const;
    }
    await tx.callSession.update({ where: { id: session.id }, data: { state: "FAILED", endedAt: new Date(), version: { increment: 1 } } });
    return { status: "NOT_STARTED", reason: outcome.kind === "REJECTED" ? "The phone carrier refused the call." : "Calling is not available right now." } as const;
  });
}
