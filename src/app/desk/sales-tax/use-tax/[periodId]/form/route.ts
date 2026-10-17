import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { loadFilingPacket } from "@/domains/tax/filing-packet";
import { fillDr0252 } from "@/domains/tax/dr0252-form";
import { businessDateKey } from "@/lib/business-date";

/** The official DR 0252 for the return's tax year, filled in with this period's numbers. OWNER and ADMIN only. Never signs or files. */
export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { periodId } = await params;
  const period = await prisma.taxFilingPeriod.findUnique({ where: { id: periodId }, select: { filingAccount: { select: { kind: true } } } });
  if (!period || period.filingAccount.kind !== "USE_TAX_RETURN") return new Response("No consumer use-tax period was found.", { status: 404 });
  const result = await loadFilingPacket(periodId);
  if (result.status !== "READY") return new Response("This return needs review before the form can be filled in.", { status: 409 });
  try {
    const filled = await fillDr0252(result.packet, businessDateKey(new Date()));
    return new Response(Buffer.from(filled.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="DR0252-${result.packet.periodEnd}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Could not fill in the form.", { status: 409 });
  }
}
