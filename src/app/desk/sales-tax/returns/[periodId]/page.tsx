import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getPrivateReturn } from "@/domains/tax/returns-view";
import { TaxActionForm } from "../../setup/forms";
import { FilingEvidenceUpload } from "../filing-evidence-upload";
import { saveReturnProgressAction, recordFiledReturnAction } from "../actions";

const money = (value: number) => (value / 100).toFixed(2);
const label = "block space-y-1 text-sm font-medium";
const control = "w-full rounded-lg border border-border bg-background p-2 text-foreground";

export default async function ReturnDetailPage({
  params,
}: { params: Promise<{ periodId: string }> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const owner = session.user.role === "OWNER";
  const { periodId } = await params;
  const { period, result } = await getPrivateReturn(periodId);
  const saved = period.entryProgress && typeof period.entryProgress === "object" &&
    !Array.isArray(period.entryProgress) ? period.entryProgress as Record<string, unknown> : {};
  return <main className="space-y-6">
    <Link className="text-sm underline" href="/desk/sales-tax/returns">← All returns</Link>
    <header className="space-y-2">
      <h2 className="text-xl font-semibold">{period.filingAccount.name}: {period.filingAccount.kind.replaceAll("_", " ")}</h2>
      <p className="text-sm text-muted-foreground">
        Period {period.periodStart.toISOString().slice(0, 10)} through {period.periodEnd.toISOString().slice(0, 10)}
        {" · "}Legal deadline {(period.legalDueOn ?? period.dueOn).toISOString().slice(0, 10)}
        {" · "}{period.status === "FILED" ? "Filed — worksheet frozen" : "Open — not yet filed"}
      </p>
      {period.status === "FILED" && <p className="text-sm">
        Filed {period.filedOn?.toISOString().slice(0, 10) ?? "unknown"} · Paid {period.paidOn?.toISOString().slice(0, 10) ?? "unknown"}
        {" · "}Confirmation {period.confirmationNumber ?? "missing"} · Paid {"$"}{money(period.amountPaidCents ?? 0)}
      </p>}
      {period.amendments.some(a => a.status === "OPEN") && <Link className="text-sm underline" href={"/desk/sales-tax/returns/" + periodId + "/amend"}>Review outstanding amendment</Link>}
      {!owner && <p className="text-sm text-muted-foreground">Read-only for administrators. Ask the owner to file, pay or mark checklist steps.</p>}
    </header>
    {result.status === "BLOCKED" ? <section className="space-y-2 rounded-lg border border-destructive p-4">
      <h3 className="font-semibold">Not ready to file</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">{result.problems.map((p,i) => <li key={i}>{p}</li>)}</ul>
      <p className="text-sm">Do not rely on guessed totals. Correct the source evidence first.</p>
    </section> : <>
      <section className="space-y-4">
        <h3 className="font-semibold">Tax return worksheet {period.status === "FILED" ? "(frozen original)" : "(live preview)"}</h3>
        <p className="text-sm">Basis: {result.packet.basis} · {result.packet.zeroReturn ? "Zero return; still requires filing" : "Tax return"}
          {" · "}<Link className="underline" href={"/desk/sales-tax/returns/" + periodId + "/csv"}>Download private CSV worksheet</Link>
        </p>
        {!!result.packet.rows.length && <div role="region" aria-label="Sales tax worksheet" tabIndex={0}
          className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[610px] text-left text-sm">
            <thead><tr className="border-b border-border">
              <th className="p-2">Area</th><th className="p-2">Filing code</th><th className="p-2">Gross</th><th className="p-2">Taxable</th><th className="p-2">Tax</th><th className="p-2">Remit</th>
            </tr></thead>
            <tbody>{result.packet.rows.map((r,i) => <tr key={r.jurisdictionId + i} className="border-b border-border">
              <td className="p-2">{r.name}</td><td className="p-2">{r.filingCode ?? "Not configured"}</td>
              <td className="p-2">{"$"}{money(r.grossSalesCents)}</td><td className="p-2">{"$"}{money(r.netTaxableCents)}</td>
              <td className="p-2">{"$"}{money(r.taxCents)}</td><td className="p-2">{"$"}{money(r.remitCents)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        {!!result.packet.useTax.length && <section className="space-y-1 rounded border border-border p-3 text-sm">
          <h4 className="font-semibold">Purchase use tax</h4>
          {result.packet.useTax.map((r,i) => <p key={r.jurisdictionId+i}>{r.name}: purchases {"$"}{money(r.purchaseCents)}, use tax {"$"}{money(r.useTaxCents)}</p>)}
        </section>}
        {result.packet.rdf && <section className="space-y-1 rounded border border-border p-3 text-sm">
          <h4 className="font-semibold">Colorado retail delivery fee — separate return</h4>
          <p>{result.packet.rdf.deliveries} deliveries · Prior credits {"$"}{money(result.packet.rdf.priorPeriodCreditCents)} · Total due {"$"}{money(result.packet.rdf.taxDueCents)}</p>
          {result.packet.rdf.rows.map((r,i) => <p key={r.rateId+i}>{r.count} at {"$"}{money(r.amountCents)} = {"$"}{money(r.totalCents)}</p>)}
        </section>}
        <div className="rounded border border-border p-3 text-sm">
          <p>On-time remit {"$"}{money(result.packet.totals.remitIfOnTimeCents)}</p>
          <p>Late remit {"$"}{money(result.packet.totals.remitIfLateCents)}</p>
          <p className="text-xs text-muted-foreground">The official portal and your evidence, not this page, establish what was actually filed or paid.</p>
        </div>
        {result.packet.warnings.length > 0 && <section className="space-y-1">
          <h4 className="font-semibold">Filing cautions and mappings</h4>
          <ul className="list-disc pl-5 text-sm">{result.packet.warnings.map((w,i) => <li key={i}>{w}</li>)}</ul>
        </section>}
      </section>
      {period.status === "OPEN" && <section className="space-y-4">
        <h3 className="font-semibold">Step-by-step filing instructions</h3>
        {owner ? <TaxActionForm action={saveReturnProgressAction} title="Save checklist (not filing)" submitLabel="Save progress">
          <input type="hidden" name="periodId" value={periodId} />
          {result.packet.steps.map((step,i) => <label key={i} className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="complete" value={"step:"+i} defaultChecked={saved["step:"+i] === true} />
            <span>{step}</span>
          </label>)}
          <p className="text-xs text-muted-foreground">Checkmarks do not file a return or pay the government.</p>
        </TaxActionForm> : <ol className="list-decimal space-y-2 pl-5 text-sm">{result.packet.steps.map((step,i) => <li key={i}>{step}</li>)}</ol>}
        {owner && <TaxActionForm action={recordFiledReturnAction} title="Record an actual filing AND payment"
          submitLabel="Record filed and paid">
          <input type="hidden" name="periodId" value={periodId} />
          <p className="text-sm text-muted-foreground">Only after completing both steps in the official portal: record dates, exact paid amount and confirmation. Filing freezes this original worksheet.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>Filed date<input name="filedOn" type="date" required className={control} /></label>
            <label className={label}>Paid date<input name="paidOn" type="date" required className={control} /></label>
            <label className={label}>Actual paid amount (USD)<input name="amountPaidDollars" inputMode="decimal" placeholder="0.00" required className={control} /></label>
            <label className={label}>Official confirmation number<input name="confirmationNumber" maxLength={300} required className={control} /></label>
          </div>
          <label className={label}>Why the paid amount differs, if applicable<textarea name="amountDifferentReason" maxLength={1000} rows={2} className={control} /></label>
          <FilingEvidenceUpload periodId={periodId} />
        </TaxActionForm>}
      </section>}
    </>}
  </main>;
}

