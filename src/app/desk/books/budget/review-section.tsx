import Link from "next/link";
import { randomUUID } from "node:crypto";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney,moneyInputValue } from "@/lib/money-ui";
import { getBudgetMonthReport } from "@/domains/budget/reports";
import { previewMonthlyBudget,getMonthEndReviews } from "@/domains/budget/published";
import { publishBudgetMonthAction,saveBudgetReviewAction } from "./actions";
import { monthKey } from "@/domains/budget/report-math";
const input="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const button="rounded border border-border bg-card px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2";
const money=(n:number|null)=>n===null?"Unknown":formatMoney(n);
export async function BudgetReviewSection({userId,owner,month,planId,notice,pageSize,page}:{
 userId:string;owner:boolean;month?:string;planId?:string;notice?:string;pageSize?:string;page?:string;
}){
 const today=businessDateKey(new Date());
 const selected=month&&/^\d{4}-\d{2}$/.test(month)?month:today.slice(0,7);
 let draft:Awaited<ReturnType<typeof previewMonthlyBudget>>|null=null;
 let report:Awaited<ReturnType<typeof getBudgetMonthReport>>|null=null;
 let history:Awaited<ReturnType<typeof getMonthEndReviews>>=[];
 let error:string|null=null;
 try{
  monthKey(selected);
  [draft,report,history]=await Promise.all([
   previewMonthlyBudget(userId,selected),
   getBudgetMonthReport(userId,{month:selected,planId,
    page:Number(page??1),pageSize:Number(pageSize??25)}),
   getMonthEndReviews(userId,selected),
  ]);
 }catch(e){error=e instanceof Error?e.message:"The report needs source review.";}
 return <div className="min-w-0 max-w-full space-y-6 overflow-x-clip break-words">
  <header className="space-y-3">
   <Link href="/desk/books" className="underline">Back to Books</Link>
   <h1 className="text-2xl font-bold">Budget — monthly review</h1>
   <p>Published budget estimates are plans, not bank money or posted Books expenses. Source-backed actuals and protected liabilities stay independent. Saving a review does not close Books, file tax or contact QuickBooks.</p>
   <nav aria-label="Budget views" className="flex flex-wrap gap-3">
    <Link className="underline p-2" href="/desk/books/budget">Bank backing</Link>
    <Link className="underline p-2" href="/desk/books/budget?tab=plan">Plan ahead</Link>
    <Link className="underline p-2" href="/desk/books/budget?tab=review" aria-current="page">Monthly review</Link>
    <Link className="underline p-2" href="/desk/books/reports?kind=trends">Business trends</Link>
   </nav>
   {notice&&<p role="status" className="rounded border border-border p-3">{notice}</p>}
   <form method="GET" className="flex flex-wrap items-end gap-3">
    <input name="tab" type="hidden" value="review"/>
    <label>Month (Colorado)<input type="month" name="month" className={input} defaultValue={selected} required/></label>
    <button className={button} type="submit">View month</button>
   </form>
   {error&&<p role="alert">Reporting unavailable: {error.slice(0,300)}. No cash readiness is implied.</p>}
  </header>
  {draft&&report&&<>
   <section aria-labelledby="monthly-plan-publish" className="space-y-3 rounded border border-border p-4">
    <h2 id="monthly-plan-publish" className="text-lg font-semibold">Publish reviewed monthly plan</h2>
    <p>Current published version: {report.published?report.published.version+" — "+(report.published.stale?"Source changed; old version retained":"current source snapshot"):"Unplanned — no published baseline"}. Original versions never change if you update a target or planned bill.</p>
    <p className="text-sm">Draft source revisions: budget {draft.sourceBudgetRevision}; Books {draft.sourceBookRevision}. {draft.sourceWarnings.length?draft.sourceWarnings.join(" "):"Source dates and amounts taken from dated bill plans and savings targets."}</p>
    {owner&&<form action={publishBudgetMonthAction} className="space-y-3">
     <input name="month" type="hidden" value={selected}/>
     <input name="draftHash" type="hidden" value={draft.draftHash}/>
     <input name="budgetRevision" type="hidden" value={draft.sourceBudgetRevision}/>
     <input name="bookRevision" type="hidden" value={draft.sourceBookRevision}/>
     <input name="expectedVersion" type="hidden" value={draft.latest?.version??0}/>
     <input name="commandKey" type="hidden" value={randomUUID()}/>
     <input name="ids" type="hidden" value={JSON.stringify(draft.rows.map(r=>r.envelopeId))}/>
     <div className="relative min-w-0 max-w-full overflow-x-auto overscroll-x-contain" role="region" aria-label="Published budget source/amount table" tabIndex={0}>
      <table className="min-w-full text-sm"><caption className="text-left py-2">Owner-reviewed cost and funding draft, per envelope</caption>
       <thead><tr className="text-left border-b border-border">
        <th className="p-2" scope="col">Envelope</th>
        <th className="p-2" scope="col">Planned spending ($)</th>
        <th className="p-2" scope="col">Planned funding ($)</th>
        <th className="p-2" scope="col">Evidence quality</th>
       </tr></thead>
       <tbody>{draft.rows.map(row=><tr className="border-b border-border" key={row.envelopeId}>
        <th className="p-2 text-left font-medium" scope="row">{row.name}<small className="block text-muted-foreground">Opening saved {money(row.openingSavedCents)} · {row.sourceOccurrenceIds.length} dated cost sources</small></th>
        <td className="p-2"><label><span className="sr-only">{row.name} planned spending dollars</span><input className={input} name={"spend-"+row.envelopeId} inputMode="decimal" required defaultValue={moneyInputValue(row.plannedSpendCents)}/></label></td>
        <td className="p-2"><label><span className="sr-only">{row.name} planned funding dollars</span><input className={input} name={"fund-"+row.envelopeId} inputMode="decimal" required defaultValue={moneyInputValue(row.plannedFundCents)}/></label></td>
        <td className="p-2"><label><span className="sr-only">{row.name} source quality</span><select className={input} name={"quality-"+row.envelopeId} defaultValue={row.amountQuality}>
         <option value="EXACT">Exact source</option><option value="ESTIMATE">Estimated source</option>
         <option value="OWNER_REVIEWED">Owner reviewed manual adjustment</option></select></label></td>
       </tr>)}</tbody>
      </table>
     </div>
     <label>Reason for first issue or revised monthly plan<textarea name="note" className={input} minLength={12} maxLength={500} required/></label>
     <label className="flex gap-2"><input type="checkbox" name="confirmReviewed" required/>I reviewed actual bank obligations separately. These planning amounts do not authorize payment or cash allocation.</label>
     <button className={button} type="submit">Publish immutable version {draft.latest?draft.latest.version+1:1}</button>
    </form>}
    {!owner&&<p>Administrators can review versions; only the owner can publish or revise.</p>}
    {report.versions.length>0&&<div className="flex gap-3 flex-wrap">{report.versions.map(v=><Link key={v.id} href={"/desk/books/budget?tab=review&month="+selected+"&planId="+encodeURIComponent(v.id)} className="underline">
     Version {v.version}{v.stale?" (sources changed)":""}</Link>)}</div>}
   </section>
   <section className="rounded border border-border p-4 space-y-3" aria-labelledby="monthly-variances">
    <h2 id="monthly-variances" className="text-lg font-semibold">Published plan vs recorded movements</h2>
    <p>Planned spending is not paid spending. Actual spending is the signed budget classification of already-posted bank journal lines; funding is the separate signed allocation history. Unplanned does not mean zero.</p>
    <div className="relative min-w-0 max-w-full overflow-x-auto overscroll-x-contain" role="region" aria-label="Envelope spending, funding and commitments" tabIndex={0}><table className="min-w-full text-sm">
     <caption className="text-left py-2">Envelope spending, funding and unpaid commitments for {selected}</caption>
     <thead><tr className="border-b border-border text-left"><th scope="col" className="p-2">Envelope</th>
      <th scope="col" className="p-2">Planned cost</th><th scope="col" className="p-2">Actual spending</th>
      <th scope="col" className="p-2">Cost variance</th><th scope="col" className="p-2">Planned funding</th>
      <th scope="col" className="p-2">Allocated net</th><th scope="col" className="p-2">Unpaid bills</th>
     </tr></thead>
     <tbody>{report.envelopes.map(e=><tr key={e.id} className="border-b border-border">
      <th scope="row" className="p-2 text-left">{e.name}</th><td className="p-2">{e.plannedSpendCents===null?"Unplanned":money(e.plannedSpendCents)}</td>
      <td className="p-2">{money(e.actualSpendCents)}</td>
      <td className="p-2">{e.spendVariance.differenceCents===null?"—":money(e.spendVariance.differenceCents)} · {e.spendVariance.label}</td>
      <td className="p-2">{e.plannedFundCents===null?"Unplanned":money(e.plannedFundCents)}</td>
      <td className="p-2">{money(e.actualFundingCents)}</td><td className="p-2">{money(e.unpaidCents)}</td>
     </tr>)}</tbody>
    </table></div>
    <p role={report.unclassifiedCount?"alert":undefined}>Unclassified posted bank expense outflows: {report.unclassifiedCount} sources · {money(report.unclassifiedCents)}. These are not erased by missing envelope labels.</p>
   </section>
   <section className="rounded border border-border p-4 space-y-3">
    <h2 className="text-lg font-semibold">Accounting income, costs and bank cash — separate views</h2>
    <p>Posted journal basis: recognized revenue {money(report.profit.revenueCents)}, expenses {money(report.profit.costCents)} (including depreciation {money(report.profit.depreciationCents)}), management profit {money(report.profit.netProfitCents)}.</p>
    <p>Active business bank sources: {report.cash.status==="UNKNOWN"?"Unknown; no verified cash source":money(report.cash.openingCents)+" opening + "+money(report.cash.netCents)+" net movement = "+money(report.cash.closingCents)+" closing"}. Internal transfers cancel in combined net movement; capital and deposits are not operating profit.</p>
    <p>Protected debt and tax: {money(report.protectedCents)}; discretionary available to assign: {money(report.readyToAssignCents)}. Budget funding stays separate from bank movement.</p>
    <h3 className="font-semibold">Per-account recorded cash</h3>
    {report.cash.accounts?<ul className="list-disc pl-5">{report.cash.accounts.map(b=>
     <li key={b.id}>{b.name}: {money(b.openingCents)} opening + {money(b.netCents)} net = {money(b.closingCents)} ending</li>)}</ul>:
     <p>Unknown account openings — no source-proven cash is asserted.</p>}
    <h3 className="font-semibold">Upcoming cost coverage — reminders, not payments</h3>
    <p>30 days: due {money(report.upcoming.days30.dueCents)}, verified paid {money(report.upcoming.days30.paidCents)}, still due {money(report.upcoming.days30.unpaidCents)}.</p>
    <p>90 days: due {money(report.upcoming.days90.dueCents)}, verified paid {money(report.upcoming.days90.paidCents)}, still due {money(report.upcoming.days90.unpaidCents)}. Unverified payment claims {report.upcoming.days90.incompleteEvidence} need review.</p>
    <h3 className="font-semibold">Operating cost categories and vendors</h3>
    <div className="grid gap-3 sm:grid-cols-2">
     <div><h4 className="font-medium">Expense categories</h4>
      <ul className="list-disc pl-5">{report.categories.map(c=><li key={c.accountId}>{c.name}: {money(c.cents)} ({c.sharePercent===null?"No positive expense denominator":c.sharePercent+"%"})</li>)}</ul>
     </div>
     <div><h4 className="font-medium">Vendors</h4>
      <ul className="list-disc pl-5">{report.vendors.map(v=><li key={v.name}>{v.name}: {money(v.cents)} ({v.sharePercent===null?"No percentage":v.sharePercent+"%"})</li>)}</ul>
      <p>Unknown vendor: {money(report.costSplit.unknownVendorCents)}; recognized recurring {money(report.costSplit.recurringCents)}; one-off/unknown {money(report.costSplit.oneOffCents)}.</p>
     </div>
    </div>
   </section>
   <section className="rounded border border-border p-4 space-y-3">
    <h2 className="text-lg font-semibold">Month-end review checklist</h2>
    <p>{report.allMonthEndReady?"All software checks satisfied; independent external owner/CPA acceptance may still be pending.":"Open items remain. You may save a truthful incomplete review; this never closes Books."}</p>
    <ul className="list-disc pl-5 space-y-2">{report.checklist.map(check=><li key={check.key}>
     <strong>{check.ok?"Checked":"Needs review"}</strong> — {check.label}{check.reason?": "+check.reason:""}
    </li>)}</ul>
    {owner&&<form action={saveBudgetReviewAction} className="grid gap-3">
     <input type="hidden" name="month" value={selected}/>
     <input type="hidden" name="planId" value={report.published?.id??""}/>
     <input type="hidden" name="budgetRevision" value={report.budgetRevision}/>
     <input type="hidden" name="bookRevision" value={report.sourceRevision}/>
     <input type="hidden" name="commandKey" value={randomUUID()}/>
     <label>Private month-end review reason / unresolved actions<textarea name="reason" minLength={12} maxLength={500} className={input} required/></label>
     <label className="flex items-start gap-2"><input type="checkbox" name="confirmReviewed" required/>Save the observed outcome, including unresolved items, as an immutable review. This does not mark bank/CPA checks done.</label>
     <button className={button} type="submit">Save dated month-end evidence snapshot</button>
    </form>}
    {history.length>0&&<div className="space-y-2"><h3 className="font-semibold">Previously saved evidence — original bytes retained</h3>
     {history.map(x=><p key={x.id} className="break-words">{x.createdAt} · SHA {x.sha256.slice(0,12)} · {x.stale?"Stale after new source changes":"Source revisions unchanged"} · <Link className="underline" href={"/desk/books/budget/review/"+x.id}>Read saved review</Link></p>)}
    </div>}
   </section>
   <section className="rounded border border-border p-4 space-y-2">
    <h2 className="font-semibold text-lg">Journal-source drilldown</h2>
    <p>{report.sourceCount} individual journal lines. Changing page size does not change reported totals.</p>
    <div className="relative min-w-0 max-w-full overflow-x-auto overscroll-x-contain" role="region" aria-label="Journal source detail" tabIndex={0}><table className="min-w-full text-sm"><caption className="text-left py-2">Posted source rows (read-only)</caption>
     <thead><tr className="text-left border-b border-border"><th scope="col" className="p-2">Date</th><th scope="col" className="p-2">Source</th><th scope="col" className="p-2">Account</th><th scope="col" className="p-2">Debit</th><th scope="col" className="p-2">Credit</th></tr></thead>
     <tbody>{report.sourcePage.rows.map((r,i)=><tr className="border-b border-border" key={r.entryId+"-"+r.accountId+"-"+i}>
      <td className="p-2">{r.entryDate}</td><td className="p-2 break-all">{r.sourceType} / {r.eventKind}</td>
      <td className="p-2">{r.accountName}</td><td className="p-2">{money(r.debitCents)}</td><td className="p-2">{money(r.creditCents)}</td>
     </tr>)}</tbody>
    </table></div>
    <nav aria-label="Journal source pages" className="flex gap-3 flex-wrap">
     {report.sourcePage.page>1&&<Link className="underline" href={"/desk/books/budget?tab=review&month="+selected+"&page="+(report.sourcePage.page-1)+"&pageSize="+report.sourcePage.pageSize}>Previous</Link>}
     <span>Page {report.sourcePage.page}</span>
     {report.sourcePage.page*report.sourcePage.pageSize<report.sourcePage.totalRows&&
      <Link className="underline" href={"/desk/books/budget?tab=review&month="+selected+"&page="+(report.sourcePage.page+1)+"&pageSize="+report.sourcePage.pageSize}>Next</Link>}
    </nav>
   </section>
  </>}
 </div>;
}
