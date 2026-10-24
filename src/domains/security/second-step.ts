import { createHash, randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { sendAccountNotice } from "@/domains/account";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { AccountError, normalizePhone } from "@/domains/account/rules";
import {
  METHOD_LABEL, SIGN_IN_CODE_MINUTES, allowedMethodsFor, isSecondStepMethod, makeSixDigitCode,
  methodPolicyFromSetting, normalizeMethodPolicy, textCodesAvailable, type SecondStepMethod,
} from "./second-step-rules";

// ACC-3: how each person gets their second sign-in step. The library generates and checks the sign-in code; this file
// decides WHERE it goes (from the person's stored choice, never from the browser) and keeps the owner's rules.

export class SecondStepError extends Error {}

export type DeliveryOutcome = "SENT" | "NOT_ATTEMPTED" | "REJECTED" | "UNKNOWN";

export async function getMethodSettings() {
  const row = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { secondStepMethodsByLevel: true, securitySmsEnabled: true } });
  return { policy: methodPolicyFromSetting(row?.secondStepMethodsByLevel), securitySmsEnabled: row?.securitySmsEnabled === true };
}

/** Owner only. Never locks anyone out: the authenticator app is always allowed and existing choices keep working. */
export async function setMethodSettings(ownerId: string, input: { policy: Partial<Record<"OWNER" | "ADMIN" | "STAFF", unknown>>; securitySmsEnabled: boolean }) {
  const policy = normalizeMethodPolicy(input.policy);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
    const before = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: { secondStepMethodsByLevel: true, securitySmsEnabled: true } });
    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", secondStepMethodsByLevel: policy, securitySmsEnabled: input.securitySmsEnabled },
      update: { secondStepMethodsByLevel: policy, securitySmsEnabled: input.securitySmsEnabled },
    });
    await tx.auditLog.create({
      data: {
        userId: ownerId, action: "security.second_step_policy", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { policy: methodPolicyFromSetting(before?.secondStepMethodsByLevel), securitySmsEnabled: before?.securitySmsEnabled === true },
        newValue: { policy, securitySmsEnabled: input.securitySmsEnabled },
      },
    });
  });
  return policy;
}

export function twilioKeysPresent(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

export async function textCodesReady(): Promise<boolean> {
  const { securitySmsEnabled } = await getMethodSettings();
  return textCodesAvailable({
    production: process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production",
    keysPresent: twilioKeysPresent(),
    switchOn: securitySmsEnabled,
  });
}

async function record(userId: string, action: string, newValue: Record<string, unknown>) {
  try {
    await prisma.auditLog.create({ data: { userId, action, entityType: "User", entityId: userId, newValue: newValue as object } });
  } catch {
    // Recording must never stop a sign-in; the delivery result is still returned to the caller.
  }
}

/** Sends one code by one method. The code itself is never written to the activity record. */
async function sendCodeBy(method: "SMS" | "EMAIL", target: { email: string; phone: string | null; name: string | null }, code: string, purpose: string): Promise<DeliveryOutcome> {
  if (method === "EMAIL") {
    const r = await sendEmail({
      to: target.email,
      subject: "Your Appliance Desk code",
      text: [`Your ${purpose} code is ${code}.`, `It works for ${SIGN_IN_CODE_MINUTES} minutes. Nobody from the business will ever ask you for it. If you did not ask for it, ignore this email and tell the owner.`].join("\n\n"),
    });
    return r.sent ? "SENT" : (r.outcome && r.outcome !== "SENT" ? r.outcome : "UNKNOWN");
  }
  if (!target.phone || !(await textCodesReady())) return "NOT_ATTEMPTED";
  const r = await sendSms({ to: target.phone, body: `Robinson Appliance Rentals: your ${purpose} code is ${code}. It works for ${SIGN_IN_CODE_MINUTES} minutes. Never share it.`, purpose: "security" });
  return r.outcome;
}

/**
 * Called by the sign-in library for every code it makes. Delivers by the person's STORED choice only. A person whose
 * choice is the authenticator app, or a text that cannot be sent, gets nothing (they use the app or a backup code).
 */
export async function deliverSignInCode(user: { id: string }, code: string): Promise<DeliveryOutcome> {
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, name: true, phone: true, phoneConfirmedAt: true, secondStepMethod: true, archivedAt: true } });
  if (!row || row.archivedAt || (row.secondStepMethod !== "EMAIL" && row.secondStepMethod !== "SMS")) return "NOT_ATTEMPTED";
  const method = row.secondStepMethod;
  let outcome: DeliveryOutcome;
  try {
    outcome = method === "SMS" && !row.phoneConfirmedAt ? "NOT_ATTEMPTED" : await sendCodeBy(method, row, code, "sign-in");
  } catch {
    outcome = "UNKNOWN";
  }
  await record(user.id, "security.sign_in_code", { method, outcome });
  return outcome;
}

// ---- One-time codes we issue ourselves (phone check, switching method). Stored hashed in the Verification table. ----

const MAX_TRIES = 5;
const RESEND_SECONDS = 60;
const hashCode = (userId: string, purpose: string, code: string) => createHash("sha256").update(`${userId}:${purpose}:${code}`).digest("hex");

async function issueCode(userId: string, purpose: string, send: (code: string) => Promise<DeliveryOutcome>): Promise<DeliveryOutcome> {
  const identifier = `acc3-${purpose}-${userId}`;
  const recent = await prisma.verification.findFirst({ where: { identifier, createdAt: { gt: new Date(Date.now() - RESEND_SECONDS * 1000) } }, select: { id: true } });
  if (recent) throw new SecondStepError(`Wait a minute before asking for another code.`);
  const code = makeSixDigitCode((max) => randomInt(max));
  await prisma.$transaction([
    prisma.verification.deleteMany({ where: { identifier } }),
    prisma.verification.create({ data: { identifier, value: `${hashCode(userId, purpose, code)}:0`, expiresAt: new Date(Date.now() + SIGN_IN_CODE_MINUTES * 60_000) } }),
  ]);
  const outcome = await send(code);
  if (outcome !== "SENT") await prisma.verification.deleteMany({ where: { identifier } });
  return outcome;
}

async function checkCode(userId: string, purpose: string, code: string): Promise<void> {
  const identifier = `acc3-${purpose}-${userId}`;
  // The result is decided inside the transaction but thrown after it, so a wrong try is still counted.
  const result = await prisma.$transaction(async (tx): Promise<"ok" | "bad" | "locked"> => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${identifier}))::text`;
    const row = await tx.verification.findFirst({ where: { identifier }, orderBy: { createdAt: "desc" } });
    if (!row || row.expiresAt.getTime() <= Date.now()) return "bad";
    const [stored, triesText] = row.value.split(":");
    const tries = Number(triesText) || 0;
    if (tries >= MAX_TRIES) { await tx.verification.delete({ where: { id: row.id } }); return "locked"; }
    if (stored !== hashCode(userId, purpose, code.trim())) {
      await tx.verification.update({ where: { id: row.id }, data: { value: `${stored}:${tries + 1}` } });
      return "bad";
    }
    await tx.verification.delete({ where: { id: row.id } });
    return "ok";
  });
  if (result === "locked") throw new SecondStepError("Too many wrong tries. Ask for a new code.");
  if (result === "bad") throw new SecondStepError("That code was not accepted. Ask for a new one if it has been more than a few minutes.");
}

async function activeMember(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, email: true, name: true, phone: true, phoneConfirmedAt: true, twoFactorEnabled: true, secondStepMethod: true, archivedAt: true } });
  if (!user || user.archivedAt || (user.role !== "OWNER" && user.role !== "ADMIN" && user.role !== "STAFF")) throw new SecondStepError("This account no longer has access to make that change.");
  return user;
}

export type SecondStepView = {
  method: SecondStepMethod | null;
  enrolled: boolean;
  phone: string | null;
  phoneConfirmed: boolean;
  allowed: SecondStepMethod[];
  methodNotAllowedAnymore: boolean;
  textCodesReady: boolean;
};

export async function getSecondStepView(userId: string): Promise<SecondStepView> {
  const user = await activeMember(userId);
  const { policy } = await getMethodSettings();
  const allowed = allowedMethodsFor(user.role, policy);
  const method = isSecondStepMethod(user.secondStepMethod) ? user.secondStepMethod : user.twoFactorEnabled ? "TOTP" : null;
  return {
    method, enrolled: user.twoFactorEnabled, phone: user.phone, phoneConfirmed: Boolean(user.phone && user.phoneConfirmedAt),
    allowed, methodNotAllowedAnymore: Boolean(method && !allowed.includes(method)), textCodesReady: await textCodesReady(),
  };
}

/** Text a code to the saved phone so we know it is theirs. Needs text codes to be switched on. */
/** A phone-check code is tied to the exact number it was sent to, so changing the saved number cancels it. */
function phonePurpose(phone: string) {
  return `phone-${createHash("sha256").update(phone).digest("hex").slice(0, 16)}`;
}

export async function startPhoneConfirmation(userId: string): Promise<DeliveryOutcome> {
  const user = await activeMember(userId);
  if (!user.phone) throw new SecondStepError("Save your mobile phone number on My account first.");
  const { policy } = await getMethodSettings();
  if (!allowedMethodsFor(user.role, policy).includes("SMS")) throw new SecondStepError("Text codes are not allowed for your access level.");
  if (!(await textCodesReady())) throw new SecondStepError("Text codes are not switched on yet, so a phone cannot be checked right now.");
  const outcome = await issueCode(userId, phonePurpose(user.phone), (code) => sendCodeBy("SMS", user, code, "phone check"));
  await record(userId, "security.phone_code", { outcome });
  return outcome;
}

export async function confirmPhone(userId: string, code: string): Promise<void> {
  const user = await activeMember(userId);
  if (!user.phone) throw new SecondStepError("Save your mobile phone number on My account first.");
  await checkCode(userId, phonePurpose(user.phone), code);
  // Only the number the code was sent to can be confirmed: if it changed meanwhile, nothing is updated.
  const done = await prisma.user.updateMany({ where: { id: userId, phone: user.phone, archivedAt: null }, data: { phoneConfirmedAt: new Date() } });
  if (done.count !== 1) throw new SecondStepError("Your phone number changed. Ask for a new code.");
  await record(userId, "security.phone_confirmed", {});
}

/** Before first set-up only. The choice must be one the owner's rules allow; text also needs a checked phone. */
export async function chooseSecondStepMethod(userId: string, method: string): Promise<SecondStepMethod> {
  if (!isSecondStepMethod(method)) throw new SecondStepError("Choose an authenticator app, a text message code or an email code.");
  const user = await activeMember(userId);
  if (user.twoFactorEnabled) throw new SecondStepError("Two-step sign-in is already on. Use \"Switch method\" on My account.");
  await assertMethodUsable(user, method);
  // Recheck under a lock: enrollment finishing or the account being removed between the read above and this write must win.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const fresh = await tx.user.findUnique({ where: { id: userId }, select: { role: true, archivedAt: true, twoFactorEnabled: true, phone: true, phoneConfirmedAt: true } });
    if (!fresh || fresh.archivedAt || (fresh.role !== "OWNER" && fresh.role !== "ADMIN" && fresh.role !== "STAFF")) throw new SecondStepError("This account no longer has access to make that change.");
    if (fresh.twoFactorEnabled) throw new SecondStepError("Two-step sign-in is already on. Use \"Switch method\" on My account.");
    if (method === "SMS" && (!fresh.phone || !fresh.phoneConfirmedAt)) throw new SecondStepError("Check your phone number first.");
    await tx.user.update({ where: { id: userId }, data: { secondStepMethod: method } });
  });
  await record(userId, "security.second_step_choice", { method });
  return method;
}

async function assertMethodUsable(user: Awaited<ReturnType<typeof activeMember>>, method: SecondStepMethod) {
  const { policy } = await getMethodSettings();
  if (!allowedMethodsFor(user.role, policy).includes(method)) throw new SecondStepError(`${METHOD_LABEL[method]} is not allowed for your access level. Choose another method.`);
  if (method === "SMS") {
    if (!(await textCodesReady())) throw new SecondStepError("Text codes are not switched on yet. Choose another method.");
    if (!user.phone || !user.phoneConfirmedAt) throw new SecondStepError("Check your phone number first.");
  }
}

/** Already-enrolled people switch between text and email codes by proving the new method works first. */
export async function startMethodSwitch(userId: string, method: string): Promise<DeliveryOutcome> {
  if (method !== "SMS" && method !== "EMAIL") throw new SecondStepError("Only text or email codes can be switched to here.");
  const user = await activeMember(userId);
  if (!user.twoFactorEnabled) throw new SecondStepError("Set up two-step sign-in first.");
  await assertMethodUsable(user, method);
  const outcome = await issueCode(userId, `switch-${method}`, (code) => sendCodeBy(method, user, code, "method change"));
  await record(userId, "security.method_switch_code", { method, outcome });
  return outcome;
}

export async function confirmMethodSwitch(userId: string, method: string, code: string): Promise<void> {
  if (method !== "SMS" && method !== "EMAIL") throw new SecondStepError("Only text or email codes can be switched to here.");
  const user = await activeMember(userId);
  await assertMethodUsable(user, method);
  await checkCode(userId, `switch-${method}`, code);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const fresh = await tx.user.findUnique({ where: { id: userId }, select: { role: true, archivedAt: true, twoFactorEnabled: true } });
    if (!fresh || fresh.archivedAt || (fresh.role !== "OWNER" && fresh.role !== "ADMIN" && fresh.role !== "STAFF") || !fresh.twoFactorEnabled) throw new SecondStepError("This account no longer has access to make that change.");
    await tx.user.update({ where: { id: userId }, data: { secondStepMethod: method } });
  });
  await record(userId, "security.second_step_switch", { from: user.secondStepMethod, to: method });
  await sendAccountNotice(userId, "two_step_changed", { extra: METHOD_LABEL[method].toLowerCase() });
}

/** Where the most recent sign-in code (made in the last few minutes) went: lets the setup screen say honestly whether it was sent. */
export async function latestCodeOutcome(userId: string, sinceMs?: number): Promise<DeliveryOutcome | null> {
  // Only a code asked for after `sinceMs` counts, so a resend is never judged by the previous code. Clamped to the last 2 minutes.
  const floor = Date.now() - 2 * 60_000;
  const since = typeof sinceMs === "number" && Number.isFinite(sinceMs) ? Math.max(floor, sinceMs) : floor;
  const row = await prisma.auditLog.findFirst({
    where: { userId, action: "security.sign_in_code", createdAt: { gt: new Date(since) } },
    orderBy: { createdAt: "desc" },
    select: { newValue: true },
  });
  const outcome = (row?.newValue as { outcome?: string } | null)?.outcome;
  return typeof outcome === "string" ? (outcome as DeliveryOutcome) : null;
}

/** During first set-up (before the account page opens): save or change the person's own mobile number. Never confirms it. */
export async function savePhoneDuringSetup(userId: string, rawPhone: string): Promise<void> {
  let phone: string | null;
  try { phone = normalizePhone(rawPhone); } catch (e) { throw new SecondStepError(e instanceof AccountError ? e.message : "Enter a valid mobile phone number."); }
  if (!phone) throw new SecondStepError("Enter your mobile phone number.");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, archivedAt: true, twoFactorEnabled: true, phone: true } });
    if (!user || user.archivedAt || (user.role !== "OWNER" && user.role !== "ADMIN" && user.role !== "STAFF")) throw new SecondStepError("This account no longer has access to make that change.");
    if (user.twoFactorEnabled) throw new SecondStepError("Two-step sign-in is already on. Change your number on My account.");
    if (user.phone === phone) return;
    await tx.user.update({ where: { id: userId }, data: { phone, phoneConfirmedAt: null } });
    await tx.auditLog.create({ data: { userId, action: "security.phone_saved_in_setup", entityType: "User", entityId: userId, newValue: {} } });
  });
}
