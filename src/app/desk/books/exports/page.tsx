import Link from "next/link";
import { requireRole } from "@/lib/session";
import { businessDateKey, formatBusinessDate } from "@/lib/business-date";
import { getBookExportHistory, MODES, TARGETS } from "@/domains/books/exports";
import { runBookExportAction } from "./actions";

export const metadata={title:"Accounting exports — Books"};
const input="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const button="rounded border border-border bg-card px-3 py-2 font-medium text-foreground hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2";
const names:Record<string,string>={
 QBO_JOURNAL_CSV:"QuickBooks Online journal",XERO_JOURNAL_CSV:"Xero manual journal",
 GENERIC_JOURNAL_CSV:"Generic accounting journal",CASH_MOVEMENTS_CSV:"Cash and card movements",
 DAILY_SUMMARY:"Daily summary",DETAIL:"Journal detail",
};
export default async function BooksExportsPage({searchParams}:{
 searchParams:Promise<{notice?:string;created?:string}>
}){
 const session=await requireRole("OWNER","ADMIN");
 const params=await searchParams;
 const history=await getBookExportHistory(session.user.id);
 const today=businessDateKey(new Date());
 const currentMonth=today.slice(0,7)+"-01";
 const recent=history.find(x=>x.id===params.created);
 return <div className="space-y-6">
  <header className="space-y-2">
   <Link href="/desk/books" className="underline">Back to Books and accounts</Link>
   <h1 className="text-2xl font-bold">Accounting exports</h1>
   <p className="text-muted-foreground">Prepare an immutable journal file for your bookkeeper. This does not send a file to QuickBooks or Xero or move any money. Test a file in a trial accounting company before real use.</p>
   {params.notice&&<p role="alert" className="rounded border border-border p-3">Export needs attention: {params.notice.slice(0,600)}</p>}
   {recent&&<p role="status" className="rounded border border-border p-3">Export archived. <Link className="underline" href={`/desk/books/exports/download/${encodeURIComponent(recent.id)}`}>Download {recent.fileName}</Link></p>}
  </header>
  <section className="space-y-3 rounded-lg border border-border p-4">
   <h2 className="font-semibold text-lg">Create a mapped export</h2>
   <p>All accounts used in the journal must be mapped for this target. <Link href="/desk/books" className="underline">Edit account mappings in Books.</Link> Dates include both endpoints in Colorado time.</p>
   <form action={runBookExportAction} className="grid gap-3 sm:grid-cols-2">
    <label htmlFor="books-export-target">Accounting software</label><select id="books-export-target" name="target" required className={input}>
     {TARGETS.map(x=><option key={x} value={x}>{names[x]}</option>)}
    </select>
    <label htmlFor="books-export-mode">Detail level</label><select id="books-export-mode" name="mode" required className={input}>
     {MODES.map(x=><option key={x} value={x}>{names[x]}</option>)}
    </select>
    <label>From (Colorado date)<input type="date" name="from" defaultValue={currentMonth} required className={input}/></label>
    <label>Through (Colorado date)<input type="date" name="to" defaultValue={today} required className={input}/></label>
    <label className="sm:col-span-2 inline-flex items-start gap-2"><input type="checkbox" name="onlyNew" defaultChecked className="mt-1"/>Only journal entries not yet included in a prior export for the selected accounting software</label>
    <div className="sm:col-span-2"><button type="submit" className={button}>Create and archive CSV</button></div>
   </form>
  </section>
  <section className="space-y-3 rounded-lg border border-border p-4">
   <h2 className="text-lg font-semibold">Prior immutable exports</h2>
   <p className="text-sm text-muted-foreground">A previously generated file keeps the original bytes, even if you later rename accounts or correct entries. Re-download an old batch for audit or trial import.</p>
   {history.length===0?<p>No export batches have been saved.</p>:
    <div className="overflow-x-auto"><table className="min-w-full text-sm">
     <caption className="text-left text-muted-foreground pb-2">{history.length} most recent batches (up to 100)</caption>
     <thead><tr className="border-b border-border text-left">
       <th scope="col" className="p-2">File</th><th scope="col" className="p-2">Range</th>
       <th scope="col" className="p-2">Journal sources</th><th scope="col" className="p-2">Download</th>
     </tr></thead>
     <tbody>{history.map(batch=><tr className="border-b border-border" key={batch.id}>
       <td className="p-2 break-all">{names[batch.target]} — {names[batch.mode]}<p className="text-muted-foreground">{formatBusinessDate(batch.createdAt)}</p></td>
       <td className="p-2 whitespace-nowrap">{formatBusinessDate(batch.periodFrom)} to {formatBusinessDate(batch.periodTo)}</td>
       <td className="p-2 tabular-nums">{batch.entryCount}</td>
       <td className="p-2"><Link className="underline" href={`/desk/books/exports/download/${encodeURIComponent(batch.id)}`}>Download CSV</Link></td>
     </tr>)}</tbody>
    </table></div>}
  </section>
 </div>;
}
