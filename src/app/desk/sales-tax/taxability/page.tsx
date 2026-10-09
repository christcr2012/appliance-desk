import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { TaxChargeCategory } from "@prisma/client";
import { TaxActionForm } from "../setup/forms";
import { saveTaxCellAction, addManualRateAction } from "../setup/actions";

const css = "w-full rounded border border-input bg-background p-2 text-sm";
const label = "grid gap-1 text-sm font-medium";
export default async function TaxabilityMatrixPage() {
  const session = await requireRole("OWNER", "ADMIN");
  const defaults = await prisma.taxabilityRule.findMany({
    where: { jurisdictionId: null },
    select: { id: true, category: true, taxability: true, cpaConfirmedOn: true },
    orderBy: { category: "asc" },
  });
  const jurisdictions = await prisma.taxJurisdiction.findMany({
    select: {
      id: true, name: true, level: true, administration: true,
      rules: { select: { id: true, category: true, taxability: true, cpaConfirmedOn: true } },
    },
    orderBy: [{ level: "asc" }, { name: "asc" }], take: 75,
  });
  return <main className="space-y-5">
    <h2 className="text-xl font-semibold">What&apos;s taxed?</h2>
    <p className="text-sm text-muted-foreground">The CPA-confirmed treatment for each charge and jurisdiction. Undecided items stay undecided; no automatic filing or billing bypass is implied.</p>
    {session.user.role === "OWNER" ? <TaxActionForm
      title="Record a CPA-confirmed tax rule" action={saveTaxCellAction} submitLabel="Save tax rule">
      <div className="grid gap-3 md:grid-cols-2">
        <label className={label}>Tax area
          <select name="jurisdictionId" required className={css}>
            <option value="">Choose a jurisdiction</option>
            <option value="__DEFAULT_STATE__">All state-collected areas (default rules)</option>
            {jurisdictions.map(j => <option value={j.id} key={j.id}>{j.name} ({j.level})</option>)}
          </select>
        </label>
        <label className={label}>Charge category
          <select name="category" className={css}>
            {Object.values(TaxChargeCategory).map(c => <option key={c} value={c}>{c.replaceAll("_"," ").toLowerCase()}</option>)}
          </select>
        </label>
        <label className={label}>Decision
          <select name="taxability" className={css}>
            <option value="TAXABLE">Taxable</option><option value="EXEMPT">Exempt</option>
          </select>
        </label>
        <label className={label}>CPA confirmation date
          <input name="cpaConfirmedOn" type="date" required className={css} />
        </label>
      </div>
      <label className={label}>Reason and CPA guidance
        <textarea name="reason" required maxLength={500} className={css} rows={2} />
      </label>
    </TaxActionForm> : <p role="status" className="rounded border p-3">Read-only administrator access. Ask the owner to confirm taxability decisions.</p>}
    {session.user.role === "OWNER" && <TaxActionForm action={addManualRateAction}
      title="Append a verified tax-rate version" submitLabel="Add rate version">
      <div className="grid gap-3 md:grid-cols-2">
        <label className={label}>Jurisdiction
          <select name="jurisdictionId" required className={css}>
            <option value="">Choose an area</option>
            {jurisdictions.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </label>
        <label className={label}>Effective date
          <input name="effectiveFrom" type="date" required className={css} />
        </label>
        <label className={label}>Rate (milli-percent)
          <input name="rateMilliPercent" type="number" min={0} max={100000} required className={css} />
        </label>
        <label className={label}>Official source or CPA evidence
          <textarea name="sourceNote" maxLength={500} required className={css} rows={2} />
        </label>
      </div>
    </TaxActionForm>}
    <section className="space-y-3">
      <h3 className="font-semibold">Reviewed area matrix</h3>
      <div tabIndex={0} role="region" aria-label="Taxability rule matrix" className="overflow-x-auto rounded border border-border">
        <table className="min-w-full divide-y divide-border text-left text-sm">
          <thead className="bg-muted"><tr><th className="p-3">Jurisdiction</th><th className="p-3">Category</th><th className="p-3">Status</th><th className="p-3">CPA date</th></tr></thead>
          <tbody>{defaults.map(r => <tr key={r.id} className="border-t border-border">
            <td className="p-3">All state-collected areas (default)</td>
            <td className="p-3">{r.category.replaceAll("_", " ")}</td>
            <td className="p-3">{r.taxability}</td>
            <td className="p-3">{r.cpaConfirmedOn?.toISOString().slice(0, 10) ?? "Not confirmed"}</td>
          </tr>)}{jurisdictions.flatMap(j => j.rules.length ? j.rules.map(r => (
            <tr key={r.id} className="border-t border-border">
              <td className="p-3">{j.name}</td>
              <td className="p-3">{r.category.replaceAll("_"," ")}</td>
              <td className="p-3">{r.taxability}</td>
              <td className="p-3">{r.cpaConfirmedOn?.toISOString().slice(0,10) ?? "Not confirmed"}</td>
            </tr>
          )) : [<tr key={j.id} className="border-t border-border"><td className="p-3">{j.name}</td>
            <td colSpan={3} className="p-3 text-muted-foreground">No area-specific rules confirmed; default rules may apply</td>
          </tr>])}</tbody>
        </table>
      </div>
    </section>
  </main>;
}

