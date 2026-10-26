import type { Prisma } from "@prisma/client";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { formatMonthYear, formatShortDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { createTaskInTx } from "@/domains/tasks";
import { balancedPlan } from "@/domains/books/posting-rules";
import { writeJournal } from "@/domains/books/post";
import { ruleAsOf } from "./reads";

/**
 * TFA-1: true-up for a change put in place after its legal start date
 * (TAX-FEE-AUTOPILOT section 4a). Bills already issued in between are
 * NEVER changed. Runs in the same transaction that applies the change.
 *
 * In TFA-1 the only bill-affecting rule is `co.rdf.amount`, so only delivery
 * fees are true-up'd here. For each affected issued bill, recompute the fee
 * with the rule that should have applied on the sale date, and compare it
 * against the record's CURRENT amount — the amount already corrected by any
 * earlier true-up, not the original charge. A second late change therefore
 * adjusts incrementally (31 then 35 then 37 absorbs 4 and then 2, not 4
 * and 6); consecutive decreases likewise credit only the new difference.
 * - should have cost the customer more: the customer is not charged. The
 *   difference is the business's cost — the record's amount is corrected
 *   (filing evidence only), a balanced journal debits TAX_ABSORBED and
 *   credits RETAIL_DELIVERY_FEE_PAYABLE so the return reports it, and the
 *   owner gets a To do. A filed period picks the correction up through the
 *   existing amendment/credit scan.
 * - should have saved the customer money: a credit kept for the customer's
 *   next bill (a CustomerCredit row, not applied to any bill already sent —
 *   applying it to an older open bill would rewrite billed history; the same
 *   pattern as a waived late fee). The bill's note explains it in one
 *   sentence when the credit is used.
 * Every affected invoice is locked first (oldest first) and the approving
 * actor is re-checked, so a payment landing at the same moment serializes
 * cleanly: both land, the balance is right, one credit.
 */

export type LateChange = {
  id: string;
  ruleKey: string;
  effectiveFrom: Date;
  /** Short plain-words name, e.g. "Colorado retail delivery fee". */
  label: string;
};

export type TrueUpResult = {
  recordsExamined: number;
  recordsChanged: number;
  absorbedCents: number;
  creditedCents: number;
  credits: Array<{ customerId: string; creditId: string; amountCents: number; appliedInvoiceId: string | null }>;
};

type Tx = Prisma.TransactionClient;

async function periodLabel(tx: Tx, deliveredOn: Date): Promise<string> {
  const period = await tx.taxFilingPeriod.findFirst({
    where: {
      filingAccount: { kind: "RETAIL_DELIVERY_FEE_RETURN" },
      periodStart: { lte: deliveredOn },
      periodEnd: { gte: deliveredOn },
    },
    select: { periodStart: true },
    orderBy: [{ periodStart: "desc" }, { id: "desc" }],
  });
  return formatMonthYear(period?.periodStart ?? deliveredOn);
}

export async function trueUpLateChange(
  tx: Tx,
  actorId: string,
  change: LateChange,
  now: Date,
): Promise<TrueUpResult> {
  const result: TrueUpResult = {
    recordsExamined: 0, recordsChanged: 0, absorbedCents: 0, creditedCents: 0, credits: [],
  };
  if (change.ruleKey !== "co.rdf.amount") return result;
  await assertActiveTeamActor(tx, actorId, ["OWNER"]);

  const records = await tx.retailDeliveryFeeRecord.findMany({
    where: {
      status: "READY",
      saleOn: { gte: change.effectiveFrom, lte: now },
      amountCents: { not: null },
    },
    select: {
      id: true, saleOn: true, deliveredOn: true, amountCents: true,
      invoiceLineId: true, collectedFromCustomer: true,
    },
    orderBy: [{ saleOn: "asc" }, { id: "asc" }],
  });

  for (const record of records) {
    result.recordsExamined += 1;
    const correct = (await ruleAsOf<number>("co.rdf.amount", record.saleOn!, tx)).value;
    const recorded = record.amountCents!;
    if (correct === recorded) continue;

    const already = await tx.auditLog.findFirst({
      where: {
        action: "rules.true_up",
        entityType: "RetailDeliveryFeeRecord",
        entityId: record.id,
        newValue: { path: ["changeId"], equals: change.id },
      },
      select: { id: true },
    });
    if (already) continue;

    // Lock the issued bill first (oldest first, above), so a payment on the
    // same bill serializes instead of racing the true-up.
    let invoiceId: string | null = null;
    let customerId: string | null = null;
    if (record.invoiceLineId) {
      const lineRows = await tx.$queryRaw<Array<{ id: string; invoiceId: string }>>`
        SELECT "id", "invoiceId" FROM "InvoiceLineItem"
        WHERE "id" = ${record.invoiceLineId} FOR UPDATE
      `;
      const line = lineRows[0];
      if (!line) continue;
      const invoiceRows = await tx.$queryRaw<Array<{ id: string; customerId: string; issuedAt: Date | null }>>`
        SELECT "id", "customerId", "issuedAt" FROM "Invoice"
        WHERE "id" = ${line.invoiceId} FOR UPDATE
      `;
      const invoice = invoiceRows[0];
      if (!invoice || !invoice.issuedAt) continue;
      invoiceId = invoice.id;
      customerId = invoice.customerId;
    }

    // Re-check after the lock: a concurrent true-up may have finished while
    // this transaction waited for the invoice.
    const alreadyLocked = await tx.auditLog.findFirst({
      where: {
        action: "rules.true_up",
        entityType: "RetailDeliveryFeeRecord",
        entityId: record.id,
        newValue: { path: ["changeId"], equals: change.id },
      },
      select: { id: true },
    });
    if (alreadyLocked) continue;

    // Baseline is the record's current amount, already corrected by any
    // earlier true-up — never the original invoice line, which never changes.
    const diff = correct - recorded;
    if (diff === 0) continue;

    const label = await periodLabel(tx, record.deliveredOn);
    const startWords = formatShortDate(change.effectiveFrom, now);
    const appliedWords = formatShortDate(now, now);

    if (diff > 0) {
      // The customer is not charged more. The business pays the difference.
      const plan = balancedPlan(now, "Tax/fee the business paid for a late change", [
        { role: "TAX_ABSORBED", debitCents: diff, creditCents: 0 },
        { role: "RETAIL_DELIVERY_FEE_PAYABLE", debitCents: 0, creditCents: diff },
      ]);
      if (!plan) throw new Error("Could not book the absorbed tax/fee amount.");
      await writeJournal(tx, "TAX_FILING", change.id, `RULE_TRUE_UP_ABSORBED:${record.id}`, plan);
      await createTaskInTx(tx, { userId: actorId, role: "OWNER" }, {
        note: `You'll pay ${formatMoney(diff)} more on the ${label} return because the ${change.label} changed on ${startWords} and was put in place on ${appliedWords}.`,
        priority: "NORMAL",
        sourceKey: `rule-true-up-absorbed:${change.id}:${record.id}`,
      });
      result.absorbedCents += diff;
    } else {
      // The customer was overcharged: a credit kept for their next bill. A
      // record the business paid itself has no customer to credit; its amount
      // is still corrected below so the return reports the lower fee. The
      // credit is deliberately NOT applied to any bill already sent — the
      // oldest open bill is usually an earlier period's bill, and putting a
      // credit line on it would rewrite billed history (Codex review on PR
      // #617). It stays available (remainingCents) for the next bill, the
      // same pattern as a waived late fee.
      const creditCents = -diff;
      if (customerId) {
        const reason = `Credit: delivery fee went down on ${startWords} (${label})`;
        const existing = await tx.customerCredit.findFirst({
          where: { sourceType: "RULE_TRUE_UP", sourceId: `${change.id}:${record.id}` },
          select: { id: true },
        });
        if (!existing) {
          const credit = await tx.customerCredit.create({
            data: {
              customerId,
              amountCents: creditCents,
              remainingCents: creditCents,
              reason,
              authorizedByUserId: actorId,
              sourceType: "RULE_TRUE_UP",
              sourceId: `${change.id}:${record.id}`,
            },
          });
          result.creditedCents += creditCents;
          result.credits.push({ customerId, creditId: credit.id, amountCents: creditCents, appliedInvoiceId: null });
        }
      }
    }

    // Filing evidence only: the issued bill line is never rewritten.
    await tx.retailDeliveryFeeRecord.update({
      where: { id: record.id },
      data: { amountCents: correct },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "rules.true_up",
        entityType: "RetailDeliveryFeeRecord",
        entityId: record.id,
        oldValue: { amountCents: recorded, changeId: change.id },
        newValue: {
          amountCents: correct,
          changeId: change.id,
          absorbedCents: diff > 0 ? diff : 0,
          creditedCents: diff < 0 ? -diff : 0,
          invoiceId,
        },
      },
    });
    result.recordsChanged += 1;
  }
  return result;
}
