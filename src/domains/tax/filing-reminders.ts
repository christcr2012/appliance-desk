import { sendOwnerAlert } from "@/domains/messaging/owner-alerts";
import { businessDateKey, businessDaysBetween } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { dueOnFor, legalDueOn, periodsFor, reminderStages } from "./filing-calendar";

export type FilingReminderRun = {
  periodsCreated: number;
  emailsQueued: number;
  licenseAlerts: number;
  amendmentsDetected: number;
};
export type FilingAmendmentDetector = (now: Date) => Promise<number>;

// This integration point is installed with the real detector by T-6b2. Before
// then, return zero and never pretend that amendment comparison has run.
let amendmentDetector: FilingAmendmentDetector = async () => 0;
export function __setFilingAmendmentDetectorForTests(detector: FilingAmendmentDetector | null): void {
  amendmentDetector = detector ?? (async () => 0);
}

function daysAfter(start: Date, now: Date): number {
  return businessDaysBetween(start, now);
}
export function overdueReminderDue(legalDue: Date, today: Date): boolean {
  const days = daysAfter(legalDue, today);
  return days > 0 && (days - 1) % 3 === 0;
}
export function licenseReminderStage(expiry: Date, now: Date): string | null {
  const untilExpiry = businessDaysBetween(now, expiry);
  if ([60, 30, 7].includes(untilExpiry)) return `DUE_IN_${untilExpiry}`;
  if (untilExpiry < 0 && (-untilExpiry - 1) % 3 === 0) {
    return `OVERDUE_${businessDateKey(now)}`;
  }
  return null;
}
/** Idempotency lives in both filing-period unique keys and MessageDelivery. */
export async function runTaxFilingCalendar(now = new Date()): Promise<FilingReminderRun> {
  const totals: FilingReminderRun = {
    periodsCreated: 0, emailsQueued: 0, licenseAlerts: 0, amendmentsDetected: 0,
  };
  const today = businessDateKey(now);
  const accounts = await prisma.taxFilingAccount.findMany({
    where: { active: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  for (const account of accounts) {
    // Legacy accounts remain dormant until the Owner sets the first filing period.
    if (account.firstPeriodStart) {
      const ranges = periodsFor(account, now);
      const data = ranges.map((range) => {
        const dueOn = dueOnFor(range.end, account.dueDayOfFollowingMonth);
        return {
          filingAccountId: account.id,
          periodStart: range.start,
          periodEnd: range.end,
          dueOn,
          legalDueOn: legalDueOn(dueOn),
        };
      });
      if (data.length) {
        // The unique account/start key makes races and daily retries harmless;
        // bulk creation avoids one round trip and P2002 log per old period.
        const created = await prisma.taxFilingPeriod.createMany({ data, skipDuplicates: true });
        totals.periodsCreated += created.count;
      }

      const periods = await prisma.taxFilingPeriod.findMany({
        where: { filingAccountId: account.id, status: "OPEN", periodEnd: { lt: now } },
        orderBy: [{ periodStart: "asc" }, { id: "asc" }],
      });
      for (const period of periods) {
        if (today <= businessDateKey(period.periodEnd)) continue;
        const legalDate = period.legalDueOn ?? legalDueOn(period.dueOn);
        if (!period.legalDueOn) {
          await prisma.taxFilingPeriod.updateMany({
            where: { id: period.id, legalDueOn: null },
            data: { legalDueOn: legalDate },
          });
        }
        const stages = reminderStages(
          { periodEnd: period.periodEnd, dueOn: period.dueOn, legalDueOn: legalDate },
          account,
          now,
        );
        for (const stage of stages) {
          if (stage === "OVERDUE" && !overdueReminderDue(legalDate, now)) continue;
          if (!account.emailReminders) continue;
          const id = stage === "OVERDUE" ? `OVERDUE_${today}` : stage;
          await sendOwnerAlert({
            key: `tax-reminder:${period.id}:${id}`,
            subject: `Tax return reminder — ${account.name}`,
            text: `${account.name}: ${stage.replaceAll("_", " ")}. ${period.zeroReturn
              ? "A zero return may still be required."
              : "Check the filing worksheet and submit the return."}
Base due date: ${businessDateKey(period.dueOn)}. Legal deadline: ${businessDateKey(legalDate)}.`,
            href: "/desk/today",
          });
          totals.emailsQueued += 1;
        }
      }
    }

    if (account.licenseExpiresOn && account.emailReminders) {
      const stage = licenseReminderStage(account.licenseExpiresOn, now);
      if (stage) {
        await sendOwnerAlert({
          key: `tax-license:${account.id}:${stage}`,
          subject: `Tax license renewal — ${account.name}`,
          text: `Check or renew the ${account.name} tax license, expiring ${businessDateKey(account.licenseExpiresOn)}.`,
          href: "/desk/today",
        });
        totals.licenseAlerts += 1;
      }
    }
  }

  totals.amendmentsDetected = await amendmentDetector(now);
  return totals;
}
