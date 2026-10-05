import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { deliverMessage } from "@/domains/messaging/deliver";
import {
  LAUNCH_CONSENT,
  LAUNCH_CONSENT_VERSION,
  launchSignupSchema,
  type LaunchSignup,
} from "./schema";
import { LAUNCH_STEPS, launchMessage } from "./messages";

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

/** Interest is separate from a quote/Lead: no fake phone, customer, or reservation. */
export async function joinLaunchList(raw: LaunchSignup) {
  const input = launchSignupSchema.parse(raw);
  if (input.website) return;
  const settings = await getLaunchSettings();
  if (!settings.prelaunchMode) throw new Error("Please use our contact form now that prelaunch signup is closed.");
  await prisma.launchSubscriber.createMany({
    data: [{
      name: input.name,
      email: input.email,
      city: input.city,
      interest: input.interest,
      source: input.source || "website",
      consentVersion: LAUNCH_CONSENT_VERSION,
      consentText: LAUNCH_CONSENT,
      unsubscribeToken: randomBytes(32).toString("hex"),
    }],
    skipDuplicates: true,
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
    if (!current || current.unsubscribedAt || launchEmailBlockReason(currentSettings)) {
      await prisma.$transaction([
        prisma.launchDelivery.delete({ where: { id: delivery.id } }),
        prisma.launchSubscriber.update({ where: { id: subscriber.id }, data: { deliveryBlocked: false } }),
      ]);
      continue;
    }

    const unsubscribeUrl = `https://robinsonappliancerentals.com/launch/unsubscribe?token=${subscriber.unsubscribeToken}`;
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
      // Keep SENDING + deliveryBlocked=true. A human/provider reconciliation
      // resolves the uncertainty; PR #86's at-most-once invariant is preserved.
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
