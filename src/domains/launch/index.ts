import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { deliverMessage } from "@/domains/messaging/deliver";
import {
  LAUNCH_CONSENT,
  LAUNCH_CONSENT_VERSION,
  launchSignupSchema,
  type LaunchSignup,
} from "./schema";
import { LAUNCH_STEPS, launchMessage } from "./messages";

const CONFIRM_TOKEN_BYTES = 32;
const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hashConfirmToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function canonicalAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://robinsonappliancerentals.com";
}

export async function getLaunchSettings() {
  return prisma.launchSettings.findUniqueOrThrow({ where: { id: "singleton" } });
}

export function launchEmailBlockReason(settings: {
  prelaunchMode: boolean;
  emailEnabled: boolean;
  postalAddress: string;
  replyToEmail: string;
}): string | null {
  if (!settings.prelaunchMode) return "Prelaunch mode is off. The welcome sequence is paused.";
  if (!settings.emailEnabled) return "Launch emails are paused. Signups are still saved.";
  if (!settings.postalAddress.trim() || !settings.replyToEmail.trim()) return "Add your mailing address and reply email first.";
  if (process.env.VERCEL_ENV !== "production") return "Emails only send from the production site; previews never send launch emails.";
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return "The sending email service is not configured.";
  if (process.env.NEXT_PUBLIC_APP_URL !== "https://robinsonappliancerentals.com") return "Set the production website URL before enabling email delivery.";
  return null;
}

function launchConfirmationBlockReason(settings: {
  prelaunchMode: boolean;
  emailEnabled: boolean;
}): string | null {
  if (!settings.prelaunchMode) return "Prelaunch mode is off.";
  if (!settings.emailEnabled) return "Launch emails are paused.";
  if (process.env.VERCEL_ENV !== "production") return "Launch confirmation emails only send from production.";
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return "The sending email service is not configured.";
  if (process.env.NEXT_PUBLIC_APP_URL !== "https://robinsonappliancerentals.com") return "The production website URL is not configured.";
  return null;
}

/** Interest is separate from a quote/Lead: no fake phone, customer, or reservation.
 * The form consent is saved immediately, but marketing remains pending until the
 * mailbox owner opens the single-use confirmation link. Existing subscribers are
 * never reactivated or auto-confirmed by a repeat public signup. */
export async function joinLaunchList(raw: LaunchSignup) {
  const input = launchSignupSchema.parse(raw);
  if (input.website) return;
  const settings = await getLaunchSettings();
  if (!settings.prelaunchMode) throw new Error("Please use our contact form now that prelaunch signup is closed.");

  const token = randomBytes(CONFIRM_TOKEN_BYTES).toString("hex");
  const tokenHash = hashConfirmToken(token);
  const expiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS);
  const created = await prisma.launchSubscriber.createMany({
    data: [{
      name: input.name,
      email: input.email,
      city: input.city,
      interest: input.interest,
      source: input.source || "website",
      consentVersion: LAUNCH_CONSENT_VERSION,
      consentText: LAUNCH_CONSENT,
      unsubscribeToken: randomBytes(32).toString("hex"),
      confirmTokenHash: tokenHash,
      confirmExpiresAt: expiresAt,
    }],
    skipDuplicates: true,
  });

  // A concurrent/repeat signup cannot send another confirmation and, crucially,
  // cannot clear an existing unsubscribe or confirmation state.
  if (created.count !== 1) return;
  const subscriber = await prisma.launchSubscriber.findUniqueOrThrow({
    where: { email: input.email },
    select: { id: true, email: true, name: true },
  });

  if (launchConfirmationBlockReason(settings)) return;
  const confirmUrl = `${canonicalAppUrl()}/launch/confirm/${token}`;
  await deliverMessage({
    idempotencyKey: `launch-confirm-${subscriber.id}`,
    channel: "EMAIL",
    purpose: "TRANSACTIONAL",
    templateKey: "launch-confirm",
    customerFacing: false,
    recipient: { type: "LaunchSubscriber", id: subscriber.id, address: subscriber.email },
    subject: { type: "LaunchSubscriber", id: subscriber.id },
    render: () => ({
      subject: "Confirm your Robinson Appliance Rentals launch emails",
      text: `Hi ${subscriber.name},\n\nPlease confirm that this email address belongs to you before we send launch updates.\n\nConfirm: ${confirmUrl}\n\nIf you didn't request this, you can ignore this message and you won't receive the launch sequence.`,
      actionLabel: "Confirm launch emails",
    }),
  });
}

/** Single-use mailbox confirmation. Concurrent/replayed confirmations can only
 * win the compare-and-set once, so they cannot cause duplicate welcome sends. */
export async function confirmLaunchSubscription(
  token: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(token)) return false;
  const tokenHash = hashConfirmToken(token.toLowerCase());
  return prisma.$transaction(async (tx) => {
    const subscriber = await tx.launchSubscriber.findFirst({
      where: {
        confirmTokenHash: tokenHash,
        confirmExpiresAt: { gt: now },
        confirmedAt: null,
        unsubscribedAt: null,
      },
      select: { id: true },
    });
    if (!subscriber) return false;
    const changed = await tx.launchSubscriber.updateMany({
      where: {
        id: subscriber.id,
        confirmTokenHash: tokenHash,
        confirmedAt: null,
        unsubscribedAt: null,
      },
      data: {
        confirmedAt: now,
        confirmTokenHash: null,
        confirmExpiresAt: null,
        nextSendAt: now,
      },
    });
    return changed.count === 1;
  });
}

export async function unsubscribeLaunch(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const result = await prisma.launchSubscriber.updateMany({
    where: { unsubscribeToken: token },
    data: { unsubscribedAt: new Date() },
  });
  return result.count > 0;
}

/** LaunchDelivery remains the finite sequence ledger from PR #86. MessageDelivery
 * records the provider attempt beneath it. UNKNOWN deliberately leaves the
 * LaunchDelivery in SENDING so the sequence never blindly advances or retries. */
export async function sendLaunchSequence() {
  const settings = await getLaunchSettings();
  const blocked = launchEmailBlockReason(settings);
  if (blocked) return { sent: 0, failed: 0, blocked };

  const now = new Date();
  const due = await prisma.launchSubscriber.findMany({
    where: {
      confirmedAt: { not: null },
      unsubscribedAt: null,
      nextStep: { lt: LAUNCH_STEPS.length },
      nextSendAt: { lte: now },
      deliveryBlocked: false,
    },
    orderBy: [{ nextSendAt: "asc" }, { id: "asc" }],
    take: 25,
  });

  let sent = 0;
  let failed = 0;
  for (const subscriber of due) {
    const claimed = await prisma.launchSubscriber.updateMany({
      where: {
        id: subscriber.id,
        nextStep: subscriber.nextStep,
        confirmedAt: { not: null },
        deliveryBlocked: false,
        unsubscribedAt: null,
      },
      data: { deliveryBlocked: true },
    });
    if (!claimed.count) continue;

    const delivery = await prisma.launchDelivery.create({
      data: { subscriberId: subscriber.id, step: subscriber.nextStep, status: "SENDING" },
    });
    const [current, currentSettings] = await Promise.all([
      prisma.launchSubscriber.findUnique({ where: { id: subscriber.id } }),
      getLaunchSettings(),
    ]);
    if (!current || !current.confirmedAt || current.unsubscribedAt || launchEmailBlockReason(currentSettings)) {
      await prisma.$transaction([
        prisma.launchDelivery.delete({ where: { id: delivery.id } }),
        prisma.launchSubscriber.update({ where: { id: subscriber.id }, data: { deliveryBlocked: false } }),
      ]);
      continue;
    }

    const unsubscribeUrl = `${canonicalAppUrl()}/launch/unsubscribe?token=${subscriber.unsubscribeToken}`;
    const message = launchMessage(subscriber.nextStep, subscriber.name);
    const result = await deliverMessage({
      idempotencyKey: `launch-${subscriber.id}-${subscriber.nextStep}`,
      channel: "EMAIL",
      purpose: "MARKETING",
      templateKey: `launch-step-${subscriber.nextStep}`,
      customerFacing: false,
      recipient: { type: "LaunchSubscriber", id: subscriber.id, address: subscriber.email },
      subject: { type: "LaunchSubscriber", id: subscriber.id },
      render: () => ({
        subject: message.subject,
        text: message.text,
        marketing: { postalAddress: currentSettings.postalAddress, unsubscribeUrl },
      }),
    });

    if (result.state === "ACCEPTED" || result.state === "DELIVERED") {
      const nextStep = subscriber.nextStep + 1;
      const delayDays = LAUNCH_STEPS[nextStep]?.delayAfterPreviousDays ?? 0;
      await prisma.$transaction([
        prisma.launchDelivery.update({
          where: { id: delivery.id },
          data: { status: "SENT", finishedAt: new Date() },
        }),
        prisma.launchSubscriber.update({
          where: { id: subscriber.id },
          data: {
            nextStep,
            nextSendAt: new Date(Date.now() + delayDays * 86_400_000),
            deliveryBlocked: false,
          },
        }),
      ]);
      sent += 1;
    } else if (result.state === "UNKNOWN") {
      failed += 1;
    } else {
      await prisma.launchDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", finishedAt: new Date() },
      });
      failed += 1;
    }

    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { sent, failed, blocked: null };
}
