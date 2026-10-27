import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { refreshNoticeIfStale } from "@/domains/collections/actions";
import { readNoticeWording } from "@/domains/collections/engine";
import { daysPastDue } from "@/domains/collections/rules";
import { renderFinalNoticeLetterPdf } from "@/domains/collections/templates";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ stepId: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { stepId } = await params;
  await refreshNoticeIfStale(decodeURIComponent(stepId));
  const wording = await readNoticeWording();
  const step = await prisma.collectionStep.findUnique({
    where: { id: decodeURIComponent(stepId) },
    select: {
      kind: true, amountOwedCents: true,
      invoice: { select: { invoiceNumber: true, dueDate: true, agreement: { select: { serviceAddress: { select: { line1: true, line2: true, city: true, state: true, zip: true } } } } } },
      customer: { select: { user: { select: { name: true } } } },
    },
  });
  if (!step || step.kind !== "FINAL_NOTICE" || !step.invoice.dueDate) return new Response("Not found.", { status: 404 });
  const now = new Date();
  const a = step.invoice.agreement?.serviceAddress;
  const longDate = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/Denver", month: "long", day: "numeric", year: "numeric" });
  const pdf = await renderFinalNoticeLetterPdf({
    customerName: step.customer.user.name ?? "there",
    invoiceNumber: step.invoice.invoiceNumber,
    owedCents: step.amountOwedCents,
    dueOnText: longDate(step.invoice.dueDate),
    daysPastDue: daysPastDue(businessDateKey(step.invoice.dueDate), businessDateKey(now)),
    todayText: longDate(now),
    ...wording,
    addressLines: a ? [step.customer.user.name ?? "", a.line1, a.line2 ?? "", `${a.city}, ${a.state} ${a.zip}`].filter(Boolean) : [],
  });
  return new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=\"final-notice.pdf\"", "cache-control": "no-store" } });
}
