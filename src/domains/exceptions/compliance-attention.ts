import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { businessDaysBetween } from "@/lib/business-date";
import { getRuleTimingSettings } from "@/domains/rules/reads";
import { obligationByKey } from "@/domains/compliance/registry";
import type { ExceptionItem } from "./rules";

type Rows = { rows: ExceptionItem[]; total: number };

function bounded(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("A bounded task limit is required.");
}

/**
 * CMP-1: one To do item per compliance filing whose act-on date has come
 * (the timing rule already decided when to act). It turns high priority
 * when the due date is inside the owner's safety margin. Providers stay
 * read-only; the filing rows are synchronized on the attention surfaces
 * themselves (the Today page, the Taxes home page and the Compliance
 * screen) and whenever business facts are saved, so reminders never
 * depend on opening the Compliance screen first.
 */
export async function listComplianceDue(limit: number, now: Date): Promise<Rows> {
  await requireRole("OWNER", "ADMIN");
  bounded(limit);
  const { marginBusinessDays: margin } = await getRuleTimingSettings();
  const where = {
    state: { in: ["UPCOMING", "READY_FOR_REVIEW", "APPROVED", "REJECTED"] },
    actOn: { lte: now },
  };
  const filings = await prisma.complianceFiling.findMany({
    where,
    orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    take: limit,
  });
  return {
    rows: filings.map((f): ExceptionItem => {
      const obligation = obligationByKey(f.obligationKey);
      const title = obligation ? obligation.title : f.obligationKey;
      const daysLeft = businessDaysBetween(now, f.dueOn);
      return {
        category: "COMPLIANCE_DUE",
        severity: daysLeft <= margin ? "high" : "medium",
        title: `${title} (${f.periodKey})`,
        detail:
          f.state === "READY_FOR_REVIEW"
            ? "The numbers are prepared and waiting for your review and approval."
            : f.state === "APPROVED"
              ? "Approved — ready to submit."
              : f.state === "REJECTED"
                ? "This filing was rejected — open it to see what to fix."
                : "It's time to prepare this filing.",
        href: "/desk/compliance/" + encodeURIComponent(f.id),
        since: f.actOn,
        dueOn: f.actOn,
        dueDateOnly: true,
      };
    }),
    total: filings.length < limit ? filings.length : await prisma.complianceFiling.count({ where }),
  };
}
