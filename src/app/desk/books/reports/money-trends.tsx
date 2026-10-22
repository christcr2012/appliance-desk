import Link from "next/link";
import { getFinanceTrends } from "@/domains/budget/reports";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
const field="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const button="rounded border border-border bg-card px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2";
const money=(n:number|null|undefined)=>n===null||n===undefined?"Unknown":formatMoney(n);
export type TrendsQuery={asOf?:string;months?:string;period?:string;from?:string;to?:string;
 compare?:string;page?:string;pageSize?:string};
const options=(q:TrendsQuery)=>({
 asOf:q.asOf,months:Number(q.months??"12"),period:q.period,
 from:q.from,to:q.to,
 compare:(q.compare==="PREVIOUS_PERIOD"||q.compare==="SAME_PERIOD_LAST_YEAR"?q.compare:null),
 page:Number(q.page??"1"),pageSize:Number(q.pageSize??"25")
});
export async function MoneyTrendsSection({userId,query}:{userId:string;query:TrendsQuery}){
 let report:Awaited<ReturnType<typeof getFinanceTrends>>|null=null;
 let error:string|null=null;
 try{report=await getFinanceTrends(userId,options(query));}
 catch(e){error=e instanceof Error?e.message:"Finance report unavailable.";}
 const today=businessDateKey(new Date()),p=query.period??"ROLLING_12";
 const url=new URLSearchParams({kind:"trends",asOf:query.asOf??today,months:query.months??"12",period:p,
  ...(query.from?{from:query.from}:{}),...(query.to?{to:query.to}:{}),
  ...(query.compare?{compare:query.compare}:{})});
 return <div className="space-y-6">
  <header className="space-y-2">
   <Link href="/desk/books" className="underline">Back to Books</Link>
   <h1 className="text-2xl font-bold">Business finance trends</h1>
   <p>Actual accrual revenue and costs come from posted Books journals; bank net movement is a separate cash view. Budget allocation is neither revenue nor expense. A missing opening or bank source is Unknown, not zero cash.</p>
   <nav className="flex flex-wrap gap-3" aria-label="Finance reports">
    <Link href="/desk/books/reports?kind=profit" className="underline p-2">Profit and loss</Link>
    <Link href="/desk/books/reports?kind=balance" className="underline p-2">Balance sheet</Link>
    <Link href="/desk/books/reports?kind=trends" className="underline p-2" aria-current="page">Business trends</Link>
    <Link href="/desk/books/budget?tab=review" className="underline p-2">Monthly budget review</Link>
   </nav>
  </header>
  <section className="rounded border border-border p-4 space-y-3">
   <h2 className="font-semibold text-lg">Choose a source date and comparison</h2>
   <form method="GET" className="grid gap-3 sm:grid-cols-3">
    <input type="hidden" name="kind" value="trends"/>
    <label>As of Colorado date<input className={field} type="date" name="asOf" defaultValue={query.asOf??today} required/></label>
    <label>Monthly trend history (1–60)<input className={field} type="number" min={1} max={60} name="months" defaultValue={query.months??"12"}/></label>
    <label>Current comparison window<select className={field} name="period" defaultValue={p}>
     <option value="ROLLING_12">Rolling 12 months</option><option value="MONTH">Current month to date</option>
     <option value="QUARTER">Quarter to date</option><option value="YTD">Year to date</option>
     <option value="YEAR">Year to date (calendar year)</option><option value="CUSTOM">Custom dates, up to 366 days</option>
    </select></label>
    <label>Custom from<input type="date" name="from" className={field} defaultValue={query.from??""}/></label>
    <label>Custom through<input type="date" name="to" className={field} defaultValue={query.to??""}/></label>
    <label>Compare<select name="compare" className={field} defaultValue={query.compare??""}>
     <option value="">No comparison</option><option value="PREVIOUS_PERIOD">Previous equal-length period</option>
     <option value="SAME_PERIOD_LAST_YEAR">Same elapsed days last year</option>
    </select></label>
    <div><button className={button} type="submit">View finance report</button></div>
   </form>
  </section>
  {error&&<p role="alert">Report needs attention: {error.slice(0,400)}</p>}
  {report&&<>
   {report.reportWarnings.length>0&&<div role="alert">{report.reportWarnings.join(" ")}</div>}
   <section className="rounded border border-border p-4 space-y-3">
    <h2 className="text-lg font-semibold">Source-backed management results</h2>
    <p>Window {report.range.from}–{report.range.to}; accounting basis: posted journals (accrual). This is not a tax return, bank statement or forecast.</p>
    <dl className="grid gap-3 sm:grid-cols-4">
     <div><dt>Recognized revenue, net refunds</dt><dd className="font-semibold">{money(report.profit.revenueCents)}</dd></div>
     <div><dt>Operating expenses</dt><dd className="font-semibold">{money(report.profit.operatingCostCents)}</dd></div>
     <div><dt>Depreciation included in costs</dt><dd className="font-semibold">{money(report.profit.depreciationCents)}</dd></div>
     <div><dt>Net management profit</dt><dd className="font-semibold">{money(report.profit.netProfitCents)}</dd></div>
    </dl>
    <p>Capital, customer deposits, sales-tax liabilities and transfers are balance-sheet flows, not earned revenue. Refunds/reversals remain signed.</p>
    {report.compareRange&&<p>Comparison {report.compareRange.from}–{report.compareRange.to}: {report.compareProfit?money(report.compareProfit.netProfitCents):"Unavailable"} net profit. Revenue change: {report.compareRevenue.differenceCents===null?"—":money(report.compareRevenue.differenceCents)} ({report.compareRevenue.label}).</p>}
    <h3 className="font-semibold">Cash movement — active business bank accounts only</h3>
    <p>{report.cash.status==="UNKNOWN"?"Unknown: bank account evidence is missing.":
     money(report.cash.openingCents)+" beginning + "+money(report.cash.inflowCents)+" inflows − "+money(report.cash.outflowCents)+" outflows = "+money(report.cash.closingCents)+" closing"}.
     Transfers between selected active accounts offset in consolidated net movement; they are not profit.</p>
   </section>
   <section className="rounded border border-border p-4 space-y-3">
    <h2 className="text-lg font-semibold">Monthly profit and bank trend</h2>
    <div className="overflow-x-auto"><table className="min-w-full text-sm">
     <caption className="text-left py-2">Up to 60 complete or elapsed reporting months, actual posted ledger</caption>
     <thead><tr className="border-b border-border text-left"><th scope="col" className="p-2">Month</th>
      <th scope="col" className="p-2">Revenue</th><th scope="col" className="p-2">Expenses</th>
      <th scope="col" className="p-2">Profit</th><th scope="col" className="p-2">Net bank movement</th></tr></thead>
     <tbody>{report.timeline.map(t=><tr className="border-b border-border" key={t.month}>
      <th scope="row" className="p-2 text-left">{t.month}</th><td className="p-2">{money(t.profit.revenueCents)}</td>
      <td className="p-2">{money(t.profit.costCents)}</td><td className="p-2">{money(t.profit.netProfitCents)}</td><td className="p-2">{money(t.bank.netCents)}</td>
     </tr>)}</tbody>
    </table></div>
   </section>
   <section className="rounded border border-border p-4 space-y-3">
    <h2 className="text-lg font-semibold">Export and source drilldown</h2>
    <p>{report.sourcePage.totalRows} source journal lines; each row is posted evidence. The complete filtered CSV, not just this page, ties to management journal totals.</p>
    <Link className="underline p-2" href={"/desk/books/reports/export?"+url.toString()}>Download this filtered report CSV (not a QuickBooks import)</Link>
    <div className="overflow-x-auto"><table className="min-w-full text-sm">
     <caption className="text-left py-2">Signed journal detail, including excluded liabilities and bank flow</caption>
     <thead><tr className="text-left border-b border-border"><th scope="col" className="p-2">Date</th><th scope="col" className="p-2">Source</th>
      <th scope="col" className="p-2">Account</th><th scope="col" className="p-2">Debit</th><th scope="col" className="p-2">Credit</th></tr></thead>
     <tbody>{report.sourcePage.rows.map((r,i)=><tr className="border-b border-border" key={r.entryId+"-"+r.accountId+"-"+i}>
      <td className="p-2">{r.entryDate}</td><td className="p-2">{r.sourceType} / {r.eventKind}</td><td className="p-2">{r.accountName}</td>
      <td className="p-2">{money(r.debitCents)}</td><td className="p-2">{money(r.creditCents)}</td>
     </tr>)}</tbody>
    </table></div>
    <nav aria-label="Finance source pages" className="flex flex-wrap gap-3">
     {report.sourcePage.page>1&&<Link className="underline" href={"/desk/books/reports?"+url.toString()+"&page="+(report.sourcePage.page-1)}>Previous</Link>}
     <span>Page {report.sourcePage.page}</span>
     {report.sourcePage.page*report.sourcePage.pageSize<report.sourcePage.totalRows&&
      <Link className="underline" href={"/desk/books/reports?"+url.toString()+"&page="+(report.sourcePage.page+1)}>Next</Link>}
    </nav>
   </section>
  </>}
 </div>;
}
