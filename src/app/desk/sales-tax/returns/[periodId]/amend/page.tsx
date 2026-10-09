import Link from "next/link";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import type { FilingAmendmentPacket } from "@/domains/tax/filing";
import { TaxActionForm } from "../../../setup/forms";
import { recordFiledAmendmentAction, recordAmendmentHandledAction } from "../../actions";

function isAmendment(value: unknown): value is FilingAmendmentPacket {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return Array.isArray(p.differences) && Number.isSafeInteger(p.additionalTaxCents) &&
    p.differences.every(item => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return typeof row.key === "string" && Number.isSafeInteger(row.differenceCents) &&
        Number.isSafeInteger(row.previouslyReportedCents) && Number.isSafeInteger(row.correctedCents);
    });
}
const money = (cents: number) => (cents / 100).toFixed(2);
const field = "w-full rounded border border-border bg-background p-2";
export default async function AmendmentPage({ params }: {
  params: Promise<{ periodId: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN");
  const owner = session.user.role === "OWNER";
  const { periodId } = await params;
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(periodId)) throw new Error("Invalid filing period.");
  const period = await prisma.taxFilingPeriod.findUnique({
    where: { id: periodId }, include: {
      filingAccount: { select: { name: true } },
      amendments: { orderBy: [{ sequence: "desc" }], take: 20 },
    },
  });
  if (!period) throw new Error("Filing period not found.");
  return <main className="space-y-6">
    <Link className="text-sm underline" href={"/desk/sales-tax/returns/" + periodId}>← Original return</Link>
    <h2 className="text-xl font-semibold">Amendments — {period.filingAccount.name}</h2>
    <p className="text-sm text-muted-foreground">Corrections never overwrite the filed worksheet. Additional tax must be handled through a real amendment; zero/credit adjustments have their own documented resolution option.</p>
    {!owner && <p className="text-sm text-muted-foreground">Administrator view only — ask the owner to decide or file amendments.</p>}
    {!period.amendments.length && <p className="text-sm">No detected amendments for this period.</p>}
    {period.amendments.map(a => <section key={a.id} className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="font-semibold">Amendment #{a.sequence} — {a.status}</h3>
      <p className="text-sm">Detected {a.detectedAt.toISOString().slice(0,10)} · Additional tax {"$"}{money(a.additionalTaxCents)}</p>
      {a.status !== "OPEN" && <p className="text-sm">Resolved {a.filedOn?.toISOString().slice(0,10) ?? "outside portal"}
        {" · "}{a.confirmationNumber ?? a.notes ?? "See owner audit evidence"}</p>}
      {!isAmendment(a.packet) ? <p role="alert" className="text-sm text-destructive">The frozen amendment comparison could not be read. Do not file without source evidence.</p> : <>
        <div className="overflow-x-auto rounded border border-border" tabIndex={0} role="region" aria-label="Amendment comparison">
          <table className="min-w-[540px] w-full text-left text-sm">
            <thead><tr><th className="p-2">Tax component</th><th className="p-2">Original</th><th className="p-2">Corrected</th><th className="p-2">Difference</th></tr></thead>
            <tbody>{a.packet.differences.map((row,i) => <tr key={row.key+i} className="border-t border-border">
              <td className="p-2">{row.key}</td><td className="p-2">{"$"}{money(row.previouslyReportedCents)}</td>
              <td className="p-2">{"$"}{money(row.correctedCents)}</td><td className="p-2">{"$"}{money(row.differenceCents)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {a.status === "OPEN" && owner && <>
          <TaxActionForm title="Record amended filing and payment" submitLabel="Record amendment filed" action={recordFiledAmendmentAction}>
            <input type="hidden" name="amendmentId" value={a.id} />
            <input type="hidden" name="periodId" value={periodId} />
            <p className="text-sm text-muted-foreground">First file and settle the real amendment in the official portal. The ledger evidence is locked and audited.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Filed date<input type="date" name="filedOn" required className={field} /></label>
              <label className="text-sm">Paid date<input type="date" name="paidOn" required className={field} /></label>
              <label className="text-sm">Actual paid amount (USD)<input name="amountPaidDollars" inputMode="decimal" required className={field} placeholder="0.00" /></label>
              <label className="text-sm">Official confirmation<input name="confirmationNumber" required maxLength={300} className={field} /></label>
            </div>
            <label className="block text-sm">Explain any paid-amount difference<textarea name="amountDifferentReason" maxLength={1000} rows={2} className={field} /></label>
          </TaxActionForm>
          {a.additionalTaxCents <= 0 && <TaxActionForm title="Resolve a credit/zero-tax correction outside an amendment" submitLabel="Mark handled outside" action={recordAmendmentHandledAction}>
            <input type="hidden" name="amendmentId" value={a.id} />
            <input type="hidden" name="periodId" value={periodId} />
            <label className="block text-sm">Official disposition and evidence
              <textarea name="reason" maxLength={1000} required rows={3} className={field} />
            </label>
          </TaxActionForm>}
        </>}
      </>}
    </section>)}
  </main>;
}

