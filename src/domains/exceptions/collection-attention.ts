import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { daysPastDue } from "@/domains/collections/rules";
import type { ExceptionItem } from "./rules";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * OPS-6 To do items (owner and admins; the caller gates): a past-due notice waiting for Chris to approve, the
 * day-30 decision, and a small-claims step. Nothing here has been sent to anyone.
 */
export async function listCollectionAttention(cap: number, now: Date): Promise<{ rows: ExceptionItem[]; total: number }> {
  const where = { state: "WAITING" as const };
  const [steps, total] = await Promise.all([
    prisma.collectionStep.findMany({
      where, orderBy: [{ cameUpOn: "asc" }, { id: "asc" }], take: cap,
      select: {
        id: true, kind: true, cameUpOn: true, amountOwedCents: true,
        invoice: { select: { invoiceNumber: true, dueDate: true, agreementId: true } },
        customer: { select: { user: { select: { name: true, email: true } } } },
      },
    }),
    prisma.collectionStep.count({ where }),
  ]);
  const nowKey = businessDateKey(now);
  return {
    total,
    rows: steps.map((step) => {
      const who = step.customer.user.name ?? step.customer.user.email;
      const late = step.invoice.dueDate ? daysPastDue(businessDateKey(step.invoice.dueDate), nowKey) : 0;
      const amount = money(step.amountOwedCents);
      const href = step.kind === "DECISION" || step.kind === "SMALL_CLAIMS" ? `/desk/collections/${step.invoice.agreementId}` : "/desk/collections";
      const title = step.kind === "SECOND_NOTICE" ? `Approve second notice: ${who} owes ${amount} (${late} days late)`
        : step.kind === "FINAL_NOTICE" ? `Approve final notice: ${who} owes ${amount} (${late} days late)`
        : step.kind === "DECISION" ? `Decide: pick up the appliance, payment plan, or small claims — ${who} owes ${amount}`
        : `Small claims: ${who} owes ${amount}`;
      return {
        category: "COLLECTION_STEP",
        severity: step.kind === "SECOND_NOTICE" ? "medium" : "high",
        title,
        detail: step.kind === "DECISION"
          ? "The bill is far past due. Choose what to do; nothing happens until you do."
          : step.kind === "SMALL_CLAIMS"
            ? "Build the small-claims packet, file it yourself, then record that you filed."
            : "Read the message, then send it or skip it. Nothing has been sent to the customer.",
        href,
        since: step.cameUpOn,
      } satisfies ExceptionItem;
    }),
  };
}
