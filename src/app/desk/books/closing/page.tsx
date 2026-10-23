import Link from "next/link";
import { requireRole } from "@/lib/session";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { METRICS } from "@/domains/reports/definitions";
import { cashForecast,customerHealth,YEAR_FILES } from "@/domains/books/closing";

export const metadata={title:"Cash forecast, customer health and year-end — Books"};
const input="w-full min-w-0 rounded border border-border bg-background px-3 py-2 text-foreground";
const link="underline focus-visible:outline-2 focus-visible:outline-offset-2";
type Search={tab?:string;days?:string;year?:string};
const money=(n:number)=>formatMoney(n);
function Explain({metric}:{metric:keyof typeof METRICS}){
 const d=METRICS[metric];
 return <details className="text-sm text-muted-foreground">
  <summary className="cursor-pointer">How this is counted · {d.kind.toLowerCase()}</summary>
  <p>{d.dateBasis}. {d.calculation}</p><p>Sources: {d.sources.join(", ")}</p>
 </details>;
}
export default async function BooksClosingPage({searchParams}:{searchParams:Promise<Search>}){
 const user=(await requireRole("OWNER","ADMIN")).user;
 const q=await searchParams,today=businessDateKey(new Date()),yearToday=Number(today.slice(0,4));
 const tab=q.tab==="health"||q.tab==="year"?q.tab:"forecast";
 const days=Number(q.days??90),safeDays=Number.isSafeInteger(days)&&days>=1&&days<=180?days:90;
 const year=Number(q.year??yearToday),safeYear=Number.isSafeInteger(year)&&year>=2020&&year<=yearToday?year:yearToday;
 let error:string|null=null;
 let forecast:Awaited<ReturnType<typeof cashForecast>>|null=null;
 let health:Awaited<ReturnType<typeof customerHealth>>|null=null;
 try {
  if(tab==="forecast")forecast=await cashForecast(user.id,safeDays);
  if(tab==="health")health=await customerHealth(user.id);
 } catch(e) {error=e instanceof Error?e.message:"Books need source reconciliation.";}
 return <div className="space-y-6">
  <header className="space-y-3">
   <Link className={link} href="/desk/books">Back to Books</Link>
   <h1 className="text-2xl font-bold">Cash forecast, customer health and year-end</h1>
   <p className="text-muted-foreground">A forecast is an estimate, not money collected. Customer collections and year-end amounts come from supported source records; missing evidence stays visible for review.</p>
  </header>
  <nav aria-label="Books closing views" className="flex flex-wrap gap-4">
   <Link className={link} href="/desk/books/closing?tab=forecast" aria-current={tab==="forecast"?"page":undefined}>Cash forecast</Link>
   <Link className={link} href="/desk/books/closing?tab=health" aria-current={tab==="health"?"page":undefined}>Customer health</Link>
   <Link className={link} href="/desk/books/closing?tab=year" aria-current={tab==="year"?"page":undefined}>Year-end CSV package</Link>
  </nav>
  {error&&<p role="alert" className="rounded border border-border p-3">Report needs attention: {error.slice(0,450)}</p>}
  {tab==="forecast"&&<section className="space-y-4">
   <h2 className="text-lg font-semibold">Forecasted cash in and out — estimate</h2>
   <form method="GET" className="flex flex-wrap items-end gap-3 rounded border border-border p-4">
    <input type="hidden" name="tab" value="forecast"/>
    <label>Forecast days (1–180)<input className={input} name="days" type="number" min={1} max={180} defaultValue={safeDays} required/></label>
    <button className="rounded border border-border p-2 focus-visible:outline-2">View estimated outlook</button>
   </form>
   {!forecast&&<div role="status" className="grid gap-3 sm:grid-cols-2">
    <div className="rounded border border-border p-3"><p>No new collections — confirmed bank cash minus upcoming obligations</p><p className="font-bold">Unknown</p><p>Books source initialization and confirmed bank evidence are required to calculate this projection.</p></div>
    <div className="rounded border border-border p-3"><p>Expected collections scenario — estimate, not bank cash</p><p className="font-bold">Unknown</p><p>Future invoicing cannot be estimated until the report sources are ready; no collections are assumed.</p></div>
   </div>}
   {forecast&&<>
    <p className="text-sm text-muted-foreground">{forecast.from} through {forecast.through}. Future subscription invoices are not receipts. No live payment, provider sync, or filing is initiated.</p>
    <div className="grid gap-3 sm:grid-cols-2"><div className="rounded border border-border p-3"><p>No new collections — confirmed bank cash minus upcoming obligations</p><p className="font-bold tabular-nums">{forecast.tracks.noNewCollections.projectedCents===null?"Unknown":money(forecast.tracks.noNewCollections.projectedCents)}</p><p>First possible shortfall: {forecast.tracks.noNewCollections.firstShortfall?.date??"Unknown or none detected"}.</p><Explain metric="books.forecastCashNoNewCollections"/></div><div className="rounded border border-border p-3"><p>Expected collections scenario — estimate, not bank cash</p><p className="font-bold tabular-nums">{forecast.tracks.expectedCollections.projectedCents===null?"Unknown":money(forecast.tracks.expectedCollections.projectedCents)}</p><p>First possible shortfall: {forecast.tracks.expectedCollections.firstShortfall?.date??"Unknown or none detected"}.</p><Explain metric="books.forecastCashEstimatedCollections"/></div></div>
    <div className="grid gap-3 sm:grid-cols-3">
     <div className="rounded border border-border p-3"><p>Expected invoicing</p><p className="font-bold tabular-nums">{money(forecast.totals.inflowCents)}</p><Explain metric="books.forecastInflow"/></div>
     <div className="rounded border border-border p-3"><p>Expected costs and tax</p><p className="font-bold tabular-nums">{money(forecast.totals.outflowCents)}</p><Explain metric="books.forecastOutflow"/></div>
     <div className="rounded border border-border p-3"><p>Estimated net</p><p className="font-bold tabular-nums">{money(forecast.totals.netCents)}</p><Explain metric="books.forecastNet"/></div>
    </div>
    {forecast.needsReview.length>0&&<div role="alert" className="rounded border border-border p-3"><h3 className="font-semibold">Source review needed</h3>{forecast.needsReview.slice(0,25).map((v,i)=><p className="break-words" key={i}>{v}</p>)}</div>}
    <div className="overflow-x-auto rounded border border-border"><table className="min-w-full text-sm">
     <caption className="p-2 text-left">Source-linked future estimates, not guaranteed future cash</caption>
     <thead><tr><th className="p-2 text-left">Expected date</th><th className="p-2 text-left">Estimate source</th><th className="p-2 text-right">Estimated amount ($)</th><th className="p-2 text-left">Basis</th></tr></thead>
     <tbody>{forecast.rows.map((r,i)=><tr className="border-t border-border" key={r.sourceId+":"+r.date+":"+i}>
      <td className="p-2 whitespace-nowrap">{r.date}</td><td className="p-2">{r.label}</td>
      <td className="p-2 text-right tabular-nums">{r.kind==="BILLING_ESTIMATE"?"+":"−"}{money(r.amountCents)}</td>
      <td className="p-2">{r.kind==="BILLING_ESTIMATE"?"Future billing":r.kind==="TAX_WORKSHEET_ESTIMATE"?"Unfiled tax worksheet":"Recurring template"}</td>
     </tr>)}</tbody>
    </table></div>
   </>}
  </section>}
  {tab==="health"&&<section className="space-y-4">
   <h2 className="text-lg font-semibold">Customer health — collected facts</h2>
   {health&&<>
    <p>{health.caveat}</p>
    <div className="grid gap-3 sm:grid-cols-3">
     <div className="rounded border border-border p-3"><p>Active rental agreements</p><p className="text-xl font-bold">{health.activeRentals}</p><Explain metric="books.healthActive"/></div>
     <div className="rounded border border-border p-3"><p>Ending within 90 days</p><p className="text-xl font-bold">{health.endingNext90Days}</p><Explain metric="books.healthEnding"/></div>
     <div className="rounded border border-border p-3"><p>Known net collections</p><p className="text-xl font-bold tabular-nums">{money(health.netCollectedCents)}</p><Explain metric="books.healthNetCollected"/></div>
    </div>
    <p>Ended agreements: {health.endedRentals}. Completed, dated rentals with length evidence: {health.measuredCompleted}. Average supported rental length: {health.averageCompletedRentalMonths===null?"unknown":health.averageCompletedRentalMonths+" months"}.</p>
    <Explain metric="books.healthRentalLength"/>
    <div className="overflow-x-auto rounded border border-border"><table className="min-w-full text-sm">
     <caption className="p-2 text-left">Original linked lead sources; unknown stays unknown</caption>
     <thead><tr><th className="p-2 text-left">Lead source</th><th className="p-2 text-right">Customers</th><th className="p-2 text-right">Net collected</th></tr></thead>
     <tbody>{health.sourceGroups.map(group=><tr className="border-t border-border" key={group.leadSource}>
      <td className="p-2 break-words">{group.leadSource}</td>
      <td className="p-2 text-right tabular-nums">{group.customers}</td>
      <td className="p-2 text-right tabular-nums">{money(group.netCollectedCents)}</td>
     </tr>)}</tbody>
    </table></div>
   </>}
  </section>}
  {tab==="year"&&<section className="space-y-4">
   <h2 className="text-lg font-semibold">Year-end CSV accounting evidence</h2>
   <p>These five downloads are read-only views of supported source data, not tax returns, 1099 filings or accountant-approved balances. Use your accountant to reconcile the package before filing or importing elsewhere.</p>
   <form method="GET" className="flex flex-wrap items-end gap-3 rounded border border-border p-4">
    <input type="hidden" name="tab" value="year"/>
    <label>Reporting year<input className={input} type="number" name="year" min={2020} max={yearToday} defaultValue={safeYear} required/></label>
    <button className="rounded border border-border p-2 focus-visible:outline-2">Choose year</button>
   </form>
   <Explain metric="books.yearEndPackage"/>
   <div className="grid gap-3 sm:grid-cols-2">
    {YEAR_FILES.map(file=><div key={file} className="rounded border border-border p-3">
     <p className="font-semibold">{file==="monthly-profit"?"Monthly accrual/cash profit":file==="assets"?"Asset and depreciation register":file==="tax-filed"?"Filed sales/use tax records":file==="expenses"?"Posted expense categories":"Supplier 1099 evidence review"}</p>
     <a className={link} href={"/desk/books/closing/download?year="+safeYear+"&file="+encodeURIComponent(file)}>Download CSV</a>
    </div>)}
   </div>
   <p className="text-sm text-muted-foreground">Supplier threshold uses the current owner-configured policy; eligibility, electronic/payment-network exclusions, tax classifications and income-tax basis require CPA review. No vendor filings are submitted.</p>
  </section>}
 </div>;
}
