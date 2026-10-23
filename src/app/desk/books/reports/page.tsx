import Link from "next/link";
import { MoneyTrendsSection,type TrendsQuery } from "./money-trends";
import { requireRole } from "@/lib/session";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { METRICS } from "@/domains/reports/definitions";
import { balanceSnapshot,profitAndLoss,appliancePayback,
 type ProfitBasis,type ProfitCompare } from "@/domains/books/reports";

export const metadata={title:"Profit, balance and payback — Books"};
const input="w-full min-w-0 rounded border border-border bg-background px-3 py-2 text-foreground";
const nav="underline focus-visible:outline-2 focus-visible:outline-offset-2";
type Search=TrendsQuery&{kind?:string;basis?:string};
const safe=(value:string|undefined,pattern:RegExp,fallback:string)=>value&&pattern.test(value)?value:fallback;
const dayPattern=/^\d{4}-\d{2}-\d{2}$/;
const fmt=(n:number|null|undefined)=>n===null||n===undefined?"unknown":formatMoney(n);
function Explain({metric}:{metric:keyof typeof METRICS}){
 const definition=METRICS[metric];
 return <details className="text-sm text-muted-foreground">
  <summary className="cursor-pointer">How this is counted · {definition.kind.toLowerCase()}</summary>
  <p className="mt-1">{definition.dateBasis}. {definition.calculation}</p>
  <p>Sources: {definition.sources.join(", ")}.</p>
 </details>;
}
export default async function BooksReportsPage({searchParams}:{searchParams:Promise<Search>}){
 const session=await requireRole("OWNER","ADMIN");
 const q=await searchParams,today=businessDateKey(new Date());
 if(q.kind==="trends")return <MoneyTrendsSection userId={session.user.id} query={q}/>;
 const kind=["profit","balance","payback"].includes(q.kind??"")?q.kind??"profit":"profit";
 const from=safe(q.from,dayPattern,today.slice(0,7)+"-01");
 const to=safe(q.to,dayPattern,today);
 const asOf=safe(q.asOf,dayPattern,today);
 const basis:ProfitBasis=q.basis==="CASH"?"CASH":"ACCRUAL";
 const compare:ProfitCompare=q.compare==="PREVIOUS_PERIOD"||q.compare==="SAME_PERIOD_LAST_YEAR"?q.compare:null;
 let error:string|null=null;
 let profit:Awaited<ReturnType<typeof profitAndLoss>>|null=null;
 let balance:Awaited<ReturnType<typeof balanceSnapshot>>|null=null;
 let payback:Awaited<ReturnType<typeof appliancePayback>>|null=null;
 try{
  if(kind==="profit")profit=await profitAndLoss(session.user.id,{from,to,basis,compare});
  else if(kind==="balance")balance=await balanceSnapshot(session.user.id,asOf);
  else payback=await appliancePayback(session.user.id);
 }catch(e){error=e instanceof Error?e.message:"Unable to load source-backed accounting report.";}
 return <div className="space-y-6">
  <header className="space-y-2">
   <Link href="/desk/books" className={nav}>Back to Books and journal</Link>
   <h1 className="text-2xl font-bold">Profit, balance and payback reports</h1>
   <p className="text-muted-foreground">Read-only, source-backed numbers. Management-book profitability is not a tax return or a bank reconciliation. Missing evidence is shown instead of guessed.</p>
  </header>
  <nav aria-label="Books report type" className="flex flex-wrap gap-4">
   <Link href="/desk/books/reports?kind=trends" className={nav}>Business trends</Link>
   <Link href="/desk/books/reports?kind=profit" className={nav} aria-current={kind==="profit"?"page":undefined}>Profit and loss</Link>
   <Link href="/desk/books/reports?kind=balance" className={nav} aria-current={kind==="balance"?"page":undefined}>Balance snapshot</Link>
   <Link href="/desk/books/reports?kind=payback" className={nav} aria-current={kind==="payback"?"page":undefined}>Appliance payback</Link>
  </nav>
  {kind==="profit"&&<form method="GET" className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-3">
   <input type="hidden" name="kind" value="profit"/>
   <label>From (Colorado date)<input className={input} type="date" name="from" defaultValue={from} required/></label>
   <label>Through (Colorado date)<input className={input} type="date" name="to" defaultValue={to} required/></label>
   <label>Accounting basis<select className={input} name="basis" defaultValue={basis}>
    <option value="ACCRUAL">Accrual — earned on posted invoice date</option>
    <option value="CASH">Cash — source-linked applied funds</option>
   </select></label>
   <label>Compare to<select className={input} name="compare" defaultValue={compare??""}>
    <option value="">No comparison</option><option value="PREVIOUS_PERIOD">Previous equal-length period</option>
    <option value="SAME_PERIOD_LAST_YEAR">Same period last year</option>
   </select></label>
   <button className="rounded border border-border p-2 focus-visible:outline-2">View financial report</button>
  </form>}
  {kind==="balance"&&<form method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-4">
   <input type="hidden" name="kind" value="balance"/>
   <label>As of Colorado date<input type="date" name="asOf" className={input} defaultValue={asOf} required/></label>
   <button className="rounded border border-border p-2 focus-visible:outline-2">View balance</button>
  </form>}
  <h2 className="text-lg font-semibold">{kind==="profit"?"Profit and loss":kind==="balance"?"Balance snapshot":"Appliance payback"} — {error?"needs setup or reconciliation":"source-backed report"}</h2>
  {error&&<p role="alert" className="rounded border border-border p-3">Report needs attention: {error.slice(0,350)}</p>}
  {profit&&<section className="space-y-4">
   <h3 className="font-semibold">Basis: {profit.basis==="ACCRUAL"?"Accrual":"Cash allocated"}</h3>
   <p className="text-sm text-muted-foreground">{profit.from} through {profit.to}; includes both endpoints. {basis==="CASH"?"Cash basis recognizes only posted receipt-backed payments applied to specific issued invoices; unmatched receipts and refundable deposits are excluded. This is not a balance of your checking account.":"Accrual basis recognizes immutable posted earning and cost journal entries on their effective book dates."}</p>
   <Explain metric={basis==="CASH"?"books.cashNetProfit":"books.accrualNetProfit"}/>
   {profit.needsReview.length>0&&<div role="alert" className="rounded border border-border p-3">
    <p className="font-semibold">Incomplete source evidence — totals exclude these allocations</p>
    {profit.needsReview.slice(0,25).map((n,i)=><p className="break-words" key={i}>{n}</p>)}
   </div>}
   <div className="overflow-x-auto rounded border border-border">
    <table className="min-w-full text-sm">
     <caption className="text-left px-3 py-2">Income, discounts and refunds, and expenses, by posted ledger account</caption>
     <thead><tr className="border-b border-border text-left"><th className="p-2">Type and account</th><th className="p-2 text-right">This period</th><th className="p-2 text-right">Comparison</th><th className="p-2">Original journal</th></tr></thead>
     <tbody>{profit.summary.rows.map(row=><tr key={row.accountId} className="border-b border-border">
      <td className="p-2">{row.type==="CONTRA_INCOME"?"Less: ":row.type==="EXPENSE"?"Expense: ":"Income: "}{row.name}</td>
      <td className="p-2 text-right tabular-nums">{fmt(row.amountCents)}</td>
      <td className="p-2 text-right tabular-nums">{profit.previous?fmt(profit.previous.summary.rows.find(r=>r.accountId===row.accountId)?.amountCents??0):"—"}</td>
      <td className="p-2"><Link href={"/desk/books?month="+encodeURIComponent(from.slice(0,7))} className={nav}>{row.entryIds.length} source entries</Link></td>
     </tr>)}</tbody>
     <tfoot><tr><th className="p-2 text-left">Net management profit</th><td className="p-2 text-right font-semibold tabular-nums">{fmt(profit.summary.netProfitCents)}</td><td className="p-2 text-right tabular-nums">{profit.previous?fmt(profit.previous.summary.netProfitCents):"—"}</td><td className="p-2">Actual journals</td></tr></tfoot>
    </table>
   </div>
   {profit.previous&&<p className="text-sm text-muted-foreground">Comparison: {profit.compare?.from} through {profit.compare?.to}; {profit.previous.needsReview.length} source allocations need review.</p>}
  </section>}
  {balance&&<section className="space-y-3">
   <h3 className="font-semibold">As of {balance.asOf}</h3>
   <p>Assets equal liabilities plus owner equity and accumulated book result. Retired equipment held for disposition is still an asset, not disposal loss. Sales tax and deposits are liabilities, not income.</p>
   <Explain metric="books.totalAssets"/>
   <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr><th className="p-2 text-left">Ledger account</th><th className="p-2 text-right">Book balance</th><th className="p-2">Source</th></tr></thead><tbody>
    {balance.rows.map(row=><tr key={row.accountId} className="border-b border-border">
     <td className="p-2">{row.type==="CONTRA_ASSET"?"Less: ":""}{row.name} ({row.type})</td>
     <td className="p-2 text-right tabular-nums">{fmt(row.balanceCents)}</td>
     <td className="p-2"><Link className={nav} href="/desk/books">{row.entryIds.length} entries</Link></td>
    </tr>)}
   </tbody></table></div>
   <p className="font-semibold">Assets {fmt(balance.assetsCents)} = Liabilities {fmt(balance.liabilitiesCents)} + Equity {fmt(balance.equityCents)} + Book result {fmt(balance.retainedEarningsCents)}</p>
  </section>}
  {payback&&<section className="space-y-3">
   <h3 className="font-semibold">Invoiced rental source evidence</h3>
   <p className="text-muted-foreground text-sm">Rental and late-return invoice lines are divided across equipment assigned at that invoice period start. Payback uses invoices, not cash collected or hypothetical price-list rent; six-month run rate is a projection, not actual future money. Repair costs can be incomplete.</p>
   <Explain metric="books.applianceNet"/>
   {payback.unallocatedInvoiceCents!==0&&<p role="alert" className="rounded border border-border p-3">Cannot attribute {fmt(payback.unallocatedInvoiceCents)} in rental invoice lines to a verified appliance assignment; those amounts are omitted from per-appliance payback until reconciled.</p>}
   <div className="grid gap-3 lg:grid-cols-2">
    {payback.rows.map(a=><article className="space-y-2 rounded border border-border p-4" key={a.applianceId}>
     <h3 className="font-semibold">{a.assetNumber}</h3>
     <p>Invoiced rental income: {fmt(a.rentInvoicedCents)}</p>
     <p>Recorded repair costs: {fmt(a.repairCostCents)}{a.repairCostComplete?"":" · incomplete cost source — review"}</p>
     <p>Original cost: {a.costKnown?fmt(a.costCents??null):"unknown"}</p>
     <p>Book carrying value: {fmt(a.bookCarryingCents)}</p>
     <p>Net after cost and repairs: {fmt(a.netContributionCents)}</p>
     <p>Remaining payback at the six-month observed run rate: {a.paybackMonths===null?"unknown":a.paybackMonths+" months (estimate)"}</p>
     {a.repairWarning&&<p role="status">Repair costs exceeded the recorded rent-warning threshold; review whether this appliance remains economical.</p>}
     <Link href="/desk/fleet" className={nav}>View fleet inventory and source records</Link>
    </article>)}
   </div>
  </section>}
 </div>;
}
