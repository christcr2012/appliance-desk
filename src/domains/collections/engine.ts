// OPS-6: the nightly pass of the past-due ladder. It only writes WAITING steps (drafts for Chris); it never sends
// anything, never contacts a customer, and never takes or changes money. Safe to run twice.
import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import {
  RECOMMENDED_LADDER, daysPastDue, stepStillNeeded, stepsCameUp, validateLadder, type LadderDays,
} from "./rules";
import { renderFinalNotice, renderSecondNotice } from "./templates";

const OPEN_STATUSES = ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] as const;
const MAX_BILLS_PER_PASS = 500;

export async function readNoticeWording(): Promise<{ payHowText?: string; helpText?: string }> {
  const row = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { collectionPayHowText: true, collectionHelpText: true } });
  return { payHowText: row?.collectionPayHowText?.trim() || undefined, helpText: row?.collectionHelpText?.trim() || undefined };
}

export async function readLadder(): Promise<LadderDays> {
  const row = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { collectionSecondNoticeDay: true, collectionFinalNoticeDay: true, collectionDecisionDay: true },
  });
  const ladder: LadderDays = row
    ? { secondNotice: row.collectionSecondNoticeDay, finalNotice: row.collectionFinalNoticeDay, decision: row.collectionDecisionDay }
    : RECOMMENDED_LADDER;
  return validateLadder(ladder) ? RECOMMENDED_LADDER : ladder;
}

function longDate(date: Date): string {
  return date.toLocaleDateString("en-US", { timeZone: "America/Denver", month: "long", day: "numeric", year: "numeric" });
}

export type PassResult = { checked: number; created: number; skipped: number };

export async function runCollectionsPass(now: Date = new Date()): Promise<PassResult> {
  const ladder = await readLadder();
  const wording = await readNoticeWording();
  const nowKey = businessDateKey(now);
  const bills = await prisma.invoice.findMany({
    where: {
      status: { in: [...OPEN_STATUSES] },
      dueDate: { not: null, lt: now },
      agreementId: { not: null },
      agreement: { status: "ACTIVE" },
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    take: MAX_BILLS_PER_PASS,
    select: {
      id: true, invoiceNumber: true, dueDate: true, amountDueCents: true, amountPaidCents: true,
      agreementId: true, customerId: true,
      customer: { select: { user: { select: { name: true } } } },
    },
  });

  let created = 0;
  for (const bill of bills) {
    const owed = Math.max(0, bill.amountDueCents - bill.amountPaidCents);
    if (!stepStillNeeded(owed, true) || !bill.dueDate || !bill.agreementId) continue;
    const past = daysPastDue(businessDateKey(bill.dueDate), nowKey);
    const came = stepsCameUp(past, ladder);
    if (came.length === 0) continue;
    const facts = {
      customerName: bill.customer.user.name ?? "there",
      invoiceNumber: bill.invoiceNumber,
      owedCents: owed,
      dueOnText: longDate(bill.dueDate),
      daysPastDue: past,
      ...wording,
    };
    for (const kind of came) {
      const draft = kind === "SECOND_NOTICE" ? renderSecondNotice(facts) : kind === "FINAL_NOTICE" ? renderFinalNotice(facts) : null;
      const made = await prisma.collectionStep.createMany({
        data: [{
          invoiceId: bill.id, customerId: bill.customerId, kind, cameUpOn: now, amountOwedCents: owed,
          subject: draft?.subject ?? null, body: draft?.body ?? null,
        }],
        skipDuplicates: true,
      });
      created += made.count;
    }
    if (came.includes("DECISION")) {
      await prisma.collectionCase.upsert({
        where: { agreementId: bill.agreementId },
        create: { agreementId: bill.agreementId, customerId: bill.customerId },
        update: {},
      });
    }
  }

  // Close out waiting steps whose bill has been paid or whose rental is over, so Chris never sees a stale to-do.
  const stale = await prisma.collectionStep.findMany({
    where: { state: "WAITING" },
    take: 1000,
    select: { id: true, invoice: { select: { status: true, amountDueCents: true, amountPaidCents: true, agreement: { select: { status: true } } } } },
  });
  let skipped = 0;
  for (const step of stale) {
    const owed = Math.max(0, step.invoice.amountDueCents - step.invoice.amountPaidCents);
    const active = step.invoice.agreement?.status === "ACTIVE";
    const open = (OPEN_STATUSES as readonly string[]).includes(step.invoice.status);
    if (!stepStillNeeded(owed, active) || !open) {
      const r = await prisma.collectionStep.updateMany({
        where: { id: step.id, state: "WAITING" },
        data: { state: "SKIPPED", note: owed <= 0 ? "Paid before it was needed." : "The rental ended before it was needed.", decidedAt: now },
      });
      skipped += r.count;
    }
  }
  return { checked: bills.length, created, skipped };
}
