import Link from "next/link";
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
      <h1 className="text-xl font-semibold">Consumer use-tax worksheets</h1>
      <p className="text-sm text-ink-soft">
        Private, owner-only working figures. These are not completed official Colorado returns.
      </p>
      {periods.length === 0 ? (
        <p>No use-tax filing periods have been created yet.</p>
      ) : (
        <ul className="divide-y">
          {periods.map((period) => (
            <li key={period.id} className="py-3">
              <Link className="font-medium underline" href={`/desk/tax/use-tax-worksheets/${period.id}`}>
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
