import Link from "next/link";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { loadFilingPacket } from "@/domains/tax/filing-packet";
import { buildUseTaxWorksheet } from "@/domains/tax/dr0252-worksheet";

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
    select: { filingAccount: { select: { kind: true } } },
  });
  if (!period || period.filingAccount.kind !== "USE_TAX_RETURN") {
    return <main><h1>Use-tax worksheet unavailable</h1><p>No consumer use-tax period was found.</p></main>;
  }
  const result = await loadFilingPacket(periodId);
  const worksheet = result.status === "READY" ? buildUseTaxWorksheet(result.packet) : null;
  return (
    <main className="mx-auto max-w-3xl space-y-5 print:max-w-none">
      <nav className="print:hidden">
        <Link href="/desk/tax/use-tax-worksheets" className="text-sm underline">Back to use-tax periods</Link>
      </nav>
      {result.status === "BLOCKED" ? (
        <section>
          <h1 className="text-xl font-semibold">Worksheet needs review</h1>
          <ul className="list-disc pl-6">{result.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </section>
      ) : (
        <section className="space-y-4">
          <h1 className="text-xl font-semibold">{worksheet!.heading}</h1>
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
