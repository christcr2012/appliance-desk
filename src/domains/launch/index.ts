import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import {
  LAUNCH_CONSENT,
  LAUNCH_CONSENT_VERSION,
  launchSignupSchema,
  type LaunchSignup,
} from "./schema";
import { LAUNCH_STEPS, launchMessage } from "./messages";

export async function getLaunchSettings() {
  return prisma.launchSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
}

export function launchEmailBlockReason(settings: {
  prelaunchMode: boolean;
  emailEnabled: boolean;
  postalAddress: string;
  replyToEmail: string;
}): string | null {
  if (!settings.prelaunchMode)
    return "Prelaunch mode is off. The welcome sequence is paused.";
  if (!settings.emailEnabled)
    return "Launch emails are paused. Signups are still saved.";
  if (!settings.postalAddress.trim() || !settings.replyToEmail.trim())
    return "Add your mailing address and reply email first.";
  if (process.env.VERCEL_ENV !== "production")
    return "Emails only send from the production site; previews never send launch emails.";
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL)
    return "The sending email service is not configured.";
  // Never construct an opt-out link from a request Host header or preview URL.
  if (
    process.env.NEXT_PUBLIC_APP_URL !== "https://robinsonappliancerentals.com"
  )
    return "Set the production website URL before enabling email delivery.";
  return null;
}

/** Interest is separate from a quote/Lead: no fake phone, customer, or reservation. */
export async function joinLaunchList(raw: LaunchSignup) {
  const input = launchSignupSchema.parse(raw);
  if (input.website) return;
  const settings = await getLaunchSettings();
  if (!settings.prelaunchMode)
    throw new Error(
      "Please use our contact form now that prelaunch signup is closed.",
    );
  // Unique normalized email + createMany(skipDuplicates) makes repeated/concurrent
  // submissions no-ops, including suppressed addresses. Never overwrite consent
  // or reactivate an unsubscribe from a public form.
  await prisma.launchSubscriber.createMany({
    data: [
      {
        name: input.name,
        email: input.email,
        city: input.city,
        interest: input.interest,
        source: input.source || "website",
        consentVersion: LAUNCH_CONSENT_VERSION,
        consentText: LAUNCH_CONSENT,
        unsubscribeToken: randomBytes(32).toString("hex"),
      },
    ],
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

/** Durable at-most-once claims. Failed/uncertain attempts STOP for owner review;
 * never blindly retry a request the provider may already have accepted. Resend's
 * idempotency window is only 24h, so it is not our long-term dedupe mechanism.
 * "SENT" means accepted by Resend, not proved delivered to an inbox.
 */
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
    // Claim by compare-and-set before any network call. Concurrent cron runs
    // cannot both claim the same step, even if they both selected this row.
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
      data: {
        subscriberId: subscriber.id,
        step: subscriber.nextStep,
        status: "SENDING",
      },
    });
    // Recheck suppression and the global pause immediately before sending.
    const [current, currentSettings] = await Promise.all([
      prisma.launchSubscriber.findUnique({ where: { id: subscriber.id } }),
      getLaunchSettings(),
    ]);
    if (
      !current ||
      current.unsubscribedAt ||
      launchEmailBlockReason(currentSettings)
    ) {
      await prisma.$transaction([
        prisma.launchDelivery.delete({ where: { id: delivery.id } }),
        prisma.launchSubscriber.update({
          where: { id: subscriber.id },
          data: { deliveryBlocked: false },
        }),
      ]);
      continue;
    }
    const unsubscribeUrl = `https://robinsonappliancerentals.com/launch/unsubscribe?token=${subscriber.unsubscribeToken}`;
    const result = await sendEmail({
      to: subscriber.email,
      ...launchMessage(subscriber.nextStep, subscriber.name),
      replyTo: currentSettings.replyToEmail,
      marketing: {
        postalAddress: currentSettings.postalAddress,
        unsubscribeUrl,
      },
      idempotencyKey: `launch/${subscriber.id}/${subscriber.nextStep}`,
    });
    if (result.sent) {
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
      sent++;
    } else {
      await prisma.launchDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", finishedAt: new Date() },
      });
      failed++;
    }
    // Keep this small batch below the sender's default request-rate ceiling.
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { sent, failed, blocked: null };
}
