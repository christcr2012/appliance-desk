import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getBookAssets } from "@/domains/books/fixed-assets";
import { lastCompletedMonth } from "@/domains/books/depreciation";
import { businessDateKey, formatBusinessDate } from "@/lib/business-date";
import { formatMoney, moneyInputValue } from "@/lib/money-ui";
import {
 bookAssetPolicyAction,bookDefaultsAction,bookTaxEvidenceAction,
 enrollBookAssetAction,postBookDepreciationAction,retireBookAssetAction,
} from "./actions";
export const metadata={title:"Fixed assets — Books"};
const field="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const button="rounded border border-border bg-card px-3 py-2 font-medium text-foreground hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2";
export default async function FixedAssets({searchParams}:{searchParams:Promise<{notice?:string}>}){
 const session=await requireRole("OWNER","ADMIN");
 const data=await getBookAssets(session.user.id),owner=session.user.role==="OWNER";
 const notice=(await searchParams).notice?.slice(0,350);
 const now=businessDateKey(new Date());
 return <div className="space-y-6">
  <header className="space-y-2">
   <Link className="underline" href="/desk/books">Back to Books</Link>
   <h1 className="text-2xl font-bold">Rental equipment — book assets</h1>
   <p className="text-muted-foreground">Management depreciation is not federal or Colorado income-tax depreciation. Book carrying value is never treated as verified IRS adjusted tax basis. Your CPA confirms tax classification and allowed depreciation.</p>
   {notice&&<p role="status" className="rounded border border-border p-3">{notice}</p>}
  </header>
  <section className="rounded-lg border border-border p-4 space-y-2">
   <h2 className="font-semibold text-lg">Book depreciation policy</h2>
   <p>Default life: {data.settings?.depreciationMonthsDefault??60} months; salvage: {data.settings?.depreciationSalvagePercent??0}%. Applies to newly enrolled assets. Changing an enrolled asset's life recalculates only its remaining unposted months; old entries never change.</p>
   {owner&&<form action={bookDefaultsAction} className="grid gap-3 sm:grid-cols-3">
    <label>Default life in months<input className={field} type="number" name="months" min={1} max={360} defaultValue={data.settings?.depreciationMonthsDefault??60} required/></label>
    <label>Salvage percent<input className={field} type="number" name="salvagePercent" min={0} max={95} defaultValue={data.settings?.depreciationSalvagePercent??0} required/></label>
    <button className={button}>Save book defaults</button>
   </form>}
  </section>
  {owner&&<section className="rounded-lg border border-border p-4 space-y-3">
   <h2 className="font-semibold text-lg">Enroll verified equipment</h2>
   <p>Only appliances with an existing acquisition cost appear. Attest the management-book in-service date, on or after the Books opening date. Enrollment does not determine federal tax basis or send money.</p>
   {data.candidates.length? <form action={enrollBookAssetAction} className="grid gap-3 sm:grid-cols-3">
    <label>Appliance<select name="applianceId" required className={field}>
     {data.candidates.map(x=><option key={x.id} value={x.id}>{x.assetNumber} — {formatMoney(x.acquisitionCostCents??0)}</option>)}
    </select></label>
    <label>In-service book date<input type="date" name="placedDate" defaultValue={data.settings?.booksStartDate?businessDateKey(data.settings.booksStartDate):now} required className={field}/></label>
    <button className={button}>Enroll in book assets</button>
   </form>:<p>No untracked appliances with acquisition costs are available.</p>}
  </section>}
  <section className="space-y-3">
   <h2 className="text-lg font-semibold">Asset book records</h2>
   {data.assets.length===0?<p>No enrolled rental equipment yet.</p>:
    data.assets.map(a=><article className="rounded-lg border border-border p-4 space-y-3" key={a.applianceId}>
     <div className="flex flex-wrap gap-3 justify-between">
      <div><h3 className="font-semibold">{a.appliance.assetNumber}</h3>
       <p className="text-muted-foreground">Fleet: {a.appliance.status} · Book in service {formatBusinessDate(a.placedInServiceOn)}</p>
      </div>
      <div className="text-right tabular-nums"><p>Original book cost: {formatMoney(a.costCents)}</p><p>Recorded depreciation: {formatMoney(a.postedDepreciationCents)}</p><p className="font-semibold">Carrying value: {formatMoney(a.bookCarryingCents)}</p></div>
     </div>
     <p>Life: {a.lifeMonths} months; salvage: {a.salvagePercent}%; last accounted month: {a.lastDepreciationMonth??"None"}. {a.retiredOn? `Held for ${a.retirementIntent} since ${formatBusinessDate(a.retiredOn)}; retained value ${formatMoney(a.retiredValueCents??0)}. Not a disposal loss.`:"Still in management depreciation."}</p>
     {owner&&!a.retiredOn&&<div className="grid gap-3 lg:grid-cols-2">
      <form action={postBookDepreciationAction} className="rounded border border-border p-3 space-y-2">
       <h4 className="font-semibold">Post completed month(s)</h4>
       <input type="hidden" name="applianceId" value={a.applianceId}/>
       <label>Through Colorado month<input className={field} name="throughMonth" type="month" defaultValue={lastCompletedMonth()} required/></label>
       <button className={button}>Post depreciation</button>
      </form>
      <form action={bookAssetPolicyAction} className="rounded border border-border p-3 space-y-2">
       <h4 className="font-semibold">Future book life and salvage</h4>
       <input type="hidden" name="applianceId" value={a.applianceId}/>
       <input type="hidden" name="version" value={a.version}/>
       <label>Useful life (months)<input name="lifeMonths" className={field} type="number" min={1} max={360} defaultValue={a.lifeMonths} required/></label>
       <label>Salvage percent<input name="salvagePercent" className={field} type="number" min={0} max={95} defaultValue={a.salvagePercent} required/></label>
       <button className={button}>Save future-only policy</button>
      </form>
      {a.appliance.status==="RETIRED"?
      <form action={retireBookAssetAction} className="rounded border border-border p-3 space-y-2 lg:col-span-2">
       <h4 className="font-semibold">Hold retired value pending final disposition</h4>
       <p>Post all completed depreciation first. This does not record a sale, tax gain, write-off or disposal loss.</p>
       <input type="hidden" name="applianceId" value={a.applianceId}/>
       <input type="hidden" name="version" value={a.version}/>
       <label>Disposition intention<select name="intent" className={field} required>
        <option value="DECIDE_LATER">Decide later</option><option value="SELL">Sell</option>
        <option value="SCRAP">Scrap</option><option value="STRIP">Strip for parts</option>
        <option value="DISPOSE">Dispose</option><option value="DONATE_OTHER">Donate / other</option>
       </select></label>
       <label>Removed from rental service<input type="date" name="retiredDate" className={field} defaultValue={now} required/></label>
       <button className={button}>Record pending-retirement asset</button>
      </form>:<p className="text-sm text-muted-foreground">To retire this book asset, first change the machine to RETIRED in Fleet so it is no longer rentable.</p>}
     </div>}
     <section className="border-t border-border pt-3 space-y-2">
      <h4 className="font-semibold">Separate CPA / income-tax evidence</h4>
      <p className="text-sm text-muted-foreground">No income-tax basis or depreciation recapture is calculated from these book values. Incomplete evidence remains pending accountant review.</p>
      {a.taxEvidence.length ? a.taxEvidence.map(e=><p key={e.id} className="text-sm border-t border-border py-2">
       {e.classification} · {e.confidence} · as of {formatBusinessDate(e.evidenceAsOf)} · source: {e.sourceReference}
       {e.originalBasisCents!==null&&<> · Tax basis evidence {formatMoney(e.originalBasisCents)}</>}
       {e.cpaName&&<> · CPA {e.cpaName}</>}
      </p>):<p>Not recorded — tax basis unknown, CPA review required.</p>}
      {owner&&<details className="border border-border rounded p-3">
       <summary className="cursor-pointer font-medium">Record new CPA / tax-basis evidence (append-only)</summary>
       <form action={bookTaxEvidenceAction} className="grid gap-3 sm:grid-cols-2 mt-3">
        <input type="hidden" name="applianceId" value={a.applianceId}/>
        <label>Asset classification<select className={field} name="classification"><option value="UNKNOWN">Unknown</option><option value="RENTAL_ASSET">Rental fixed asset</option><option value="EXPENSED">Expensed</option><option value="INVENTORY">Inventory</option><option value="OTHER">Other</option></select></label>
        <label>Basis verification<select className={field} name="confidence"><option value="UNKNOWN">Unknown</option><option value="OWNER_SUPPLIED">Owner supplied, unconfirmed</option><option value="CPA_CONFIRMED">CPA confirmed</option></select></label>
        <label>Original tax basis ($)<input className={field} name="originalBasis" inputMode="decimal" placeholder="Unconfirmed"/></label>
        <label>Signed basis adjustments ($)<input className={field} name="adjustments" inputMode="decimal" placeholder="e.g. -25.00"/></label>
        <label>Allowed / allowable depreciation ($)<input className={field} name="allowed" inputMode="decimal"/></label>
        <label>Section 179 deductions ($)<input className={field} name="section179" inputMode="decimal"/></label>
        <label>Bonus depreciation ($)<input className={field} name="bonus" inputMode="decimal"/></label>
        <label>Source as-of date<input className={field} type="date" name="evidenceDate" defaultValue={now} required/></label>
        <label>Named CPA (if confirmed)<input className={field} name="cpaName" maxLength={120}/></label>
        <label>Evidence reference<input className={field} name="sourceReference" maxLength={300} required/></label>
        <button className={button}>Append tax evidence</button>
       </form>
      </details>}
     </section>
    </article>)}
  </section>
 </div>;
}
