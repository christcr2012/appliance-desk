import Link from "next/link";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { loadFilingPacket } from "@/domains/tax/filing-packet";
import { buildUseTaxWorksheet } from "@/domains/tax/dr0252-worksheet";
import { businessDateKey } from "@/lib/business-date";
import { buildUseTaxFileNow } from "@/domains/tax/use-tax-file-now";
import { FileAndPayHeadline } from "../../file-and-pay-headline";
import { FileNowPanel } from "./file-now-panel";
import { availableDr0252Years, dr0252YearFor } from "@/domains/tax/dr0252-form";

export const metadata = { title: "Consumer use-tax worksheet", robots: { index: false, follow: false } };

export default async function UseTaxWorksheetPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { periodId } = await params;
  // Check account ownership/type before asking the packet loader to read or change data.
  const period = await prisma.taxFilingPeriod.findUnique({
    where: { id: periodId },
    select: { status: true, filingAccount: { select: { kind: true } } },
  });
  if (!period || period.filingAccount.kind !== "USE_TAX_RETURN") {
    return <main><h2 className="text-xl font-semibold">Use-tax worksheet unavailable</h2><p>No consumer use-tax period was found.</p></main>;
  }
  const result = await loadFilingPacket(periodId);
  const worksheet = result.status === "READY" ? buildUseTaxWorksheet(result.packet) : null;
  return (
    <main className="mx-auto max-w-3xl space-y-5 print:max-w-none">
      <nav className="print:hidden">
        <Link href="/desk/sales-tax/use-tax" className="text-sm underline">Back to use-tax periods</Link>
      </nav>
      {result.status === "BLOCKED" ? (
        <section>
          <h2 className="text-xl font-semibold">Worksheet needs review</h2>
          <ul className="list-disc pl-6">{result.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </section>
      ) : (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">{worksheet!.heading}</h2>
          <div className="print:hidden space-y-2">
            <FileAndPayHeadline
              kind="USE_TAX_RETURN"
              amountCents={result.packet.totals.remitCents}
              legalDueOn={result.packet.legalDueOn}
              todayKey={businessDateKey(new Date())}
              filed={period.status === "FILED"}
              portalUrl={result.packet.account.portalUrl}
              useTax={result.packet.useTax.map((row) => ({ name: row.name, useTaxCents: row.useTaxCents }))}
            />
            <Link href={`/desk/sales-tax/returns/${periodId}`} className="text-sm underline">Open the guided return to copy each value and record that you filed and paid</Link>
          </div>
          <FileNowPanel steps={buildUseTaxFileNow(result.packet)} periodId={periodId} filed={period.status === "FILED"}
            formYear={dr0252YearFor(result.packet.periodEnd, availableDr0252Years())} />
          <p className="rounded-md border p-3 text-sm">
            {worksheet!.warning}
          </p>
          <dl className="divide-y">
            {worksheet!.rows.map((row, index) => (
              <div key={index} className="grid grid-cols-2 gap-4 py-2 text-sm">
                <dt>{row.label}</dt><dd className="text-right font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm">Print using your browser’s print command. Verify every entry against the official filing portal.</p>
        </section>
      )}
    </main>
  );
}
