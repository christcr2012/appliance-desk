import Link from "next/link";
import { InfoTip } from "@/components/ui/info-tip";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatBusinessDate } from "@/lib/business-date";

export const metadata = { title: "Use-tax worksheets", robots: { index: false, follow: false } };

export default async function UseTaxWorksheetsPage() {
  await requireRole("OWNER", "ADMIN");
  const periods = await prisma.taxFilingPeriod.findMany({
    where: { filingAccount: { kind: "USE_TAX_RETURN" } },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      filingAccount: { select: { name: true } },
    },
    orderBy: [{ periodStart: "desc" }, { id: "desc" }],
    take: 100,
  });
  return (
    <main className="mx-auto max-w-3xl space-y-5">
      <h2 className="text-xl font-semibold">Use tax: what you owe on purchases</h2>
      <p className="text-sm text-ink-soft">
        Use tax is the tax you owe the state yourself when a seller did not charge Colorado tax on something you bought for the business. Each period below shows what to file and pay; these are private working figures, not completed official returns. <InfoTip term="use-tax" />
      </p>
      {periods.length === 0 ? (
        <p>No use-tax filing periods have been created yet.</p>
      ) : (
        <ul className="divide-y">
          {periods.map((period) => (
            <li key={period.id} className="py-3">
              <Link className="font-medium underline" href={`/desk/sales-tax/use-tax/${period.id}`}>
                {period.filingAccount.name}: {formatBusinessDate(period.periodStart)} – {formatBusinessDate(period.periodEnd)}
              </Link>
              <span className="ml-2 text-sm text-ink-soft">{period.status}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
