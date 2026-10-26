import { prisma } from "@/lib/prisma";
import type { ExceptionItem } from "./rules";

const CAP = 20;

/**
 * OPS-1 To do items (owner and admins only; the caller gates). One item per recall (never one per appliance), and one per
 * injury or safety incident still waiting for a decision. Both are "high" because they are safety questions.
 */
export async function listRecallAttention(now: Date): Promise<ExceptionItem[]> {
  const [possible, incidents] = await Promise.all([
    prisma.recallMatch.groupBy({
      by: ["recallId", "title", "url"],
      where: { state: "POSSIBLE" },
      _count: { _all: true },
      _min: { createdAt: true },
      orderBy: { _min: { createdAt: "asc" } },
      take: CAP,
    }),
    prisma.safetyIncident.findMany({
      where: { decision: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: CAP,
      select: { id: true, createdAt: true, description: true },
    }),
  ]);
  const items: ExceptionItem[] = possible.map((row) => ({
    category: "RECALL_POSSIBLE",
    severity: "high",
    title: `Possible recall: ${row.title} — ${row._count._all} of your appliances`,
    detail: "The government's recall list may cover machines you own. Nothing is blocked until you confirm. Check the model numbers and say whether it's yours.",
    href: `/desk/recalls/${encodeURIComponent(row.recallId)}`,
    since: row._min.createdAt ?? now,
  }));
  for (const incident of incidents) {
    const deadline = new Date(incident.createdAt.getTime() + 24 * 60 * 60 * 1000);
    items.push({
      category: "SAFETY_INCIDENT",
      severity: "high",
      title: "Decide within 24 hours whether to report a safety incident to the government",
      detail: `${incident.description.slice(0, 200)} If a product could cause injury, a business that sells or rents it may have to report to the U.S. Consumer Product Safety Commission within 24 hours. Your attorney can confirm whether that applies to renting.`,
      href: `/desk/recalls/incidents/${incident.id}`,
      sourceHref: "https://www.saferproducts.gov/",
      sourceLabel: "Report on SaferProducts.gov",
      since: incident.createdAt,
      dueOn: deadline,
    });
  }
  return items;
}
