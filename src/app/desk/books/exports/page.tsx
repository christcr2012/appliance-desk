import Link from "next/link";
import { requireRole } from "@/lib/session";
import { businessDateKey, formatBusinessDate } from "@/lib/business-date";
import { getBookExportHistory, MODES, TARGETS } from "@/domains/books/exports";
import { runBookExportAction, registerQboDeliveryAction, decideQboDeliveryAction } from "./actions";

export const metadata={title:"Accounting exports — Books"};
const input="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const button="rounded border border-border bg-card px-3 py-2 font-medium text-foreground hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2";
const names:Record<string,string>={
 QBO_JOURNAL_CSV:"QuickBooks Online journal",XERO_JOURNAL_CSV:"Xero manual journal",
 GENERIC_JOURNAL_CSV:"Generic accounting journal",CASH_MOVEMENTS_CSV:"Cash and card movements",
 DAILY_SUMMARY:"Daily summary",DETAIL:"Journal detail",
};
export default async function BooksExportsPage({searchParams}:{
 searchParams:Promise<{notice?:string;created?:string;imported?:string}>
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
   {params.imported&&<p role="alert">Already imported: the original archived file is available for inspection, not a second upload.</p>}
   {recent&&<p role="status" className="rounded border border-border p-3">Export archived. <Link className="underline" href={`/desk/books/exports/download/${encodeURIComponent(recent.id)}`}>Download {recent.fileName}</Link></p>}
  </header>
  <section className="space-y-3 rounded-lg border border-border p-4">
   <h2 className="font-semibold text-lg">Create a mapped export</h2>
   <p>QuickBooks default is journal detail to preserve individual bank matching. A daily summary combines many journal sources and cannot reliably match bank lines. All accounts used in the journal must be mapped for this target. <Link href="/desk/books" className="underline">Edit account mappings in Books.</Link> Dates include both endpoints in Colorado time.</p>
   <form action={runBookExportAction} className="grid gap-3 sm:grid-cols-2">
    <label htmlFor="books-export-target">Accounting software</label><select id="books-export-target" name="target" required className={input}>
     {TARGETS.map(x=><option key={x} value={x}>{names[x]}</option>)}
    </select>
    <label htmlFor="books-export-mode">Detail level</label><select id="books-export-mode" name="mode" required className={input}>
     {MODES.map(x=><option key={x} value={x}>{names[x]}{x==="DAILY_SUMMARY"?" (advanced, bank-matching risk)":""}</option>)}
    </select>
    <label>QuickBooks company or trial tenant (only needed for QBO)<input name="qboTenantLabel" minLength={3} maxLength={100} placeholder="Company label, not account login" className={input}/></label>
    <label>QuickBooks edition (only QBO)<select className={input} name="qboEdition" defaultValue="OTHER">
      <option value="FREE">Free — import capability unverified</option>
      <option value="SIMPLE_START">Simple Start</option><option value="ESSENTIALS">Essentials</option>
      <option value="PLUS">Plus</option><option value="OTHER">Other or not yet verified</option>
    </select></label>
    <label className="sm:col-span-2 flex items-start gap-2"><input type="checkbox" name="qboSummaryRiskAccepted" className="mt-1"/>I accept that QuickBooks DAILY_SUMMARY combines journals and may prevent matching individual bank rows. Required only for that advanced mode.</label>
    <label>From (Colorado date)<input type="date" name="from" defaultValue={currentMonth} required className={input}/></label>
    <label>Through (Colorado date)<input type="date" name="to" defaultValue={today} required className={input}/></label>
    <label className="sm:col-span-2 inline-flex items-start gap-2"><input type="checkbox" name="onlyNew" defaultChecked className="mt-1"/>Only journal entries not yet included in a prior export for the selected accounting software</label>
    <div className="sm:col-span-2"><button type="submit" className={button}>Create and archive CSV</button></div>
   </form>
  </section>
  <section className="space-y-3 rounded-lg border border-border p-4">
   <h2 className="text-lg font-semibold">Prior immutable exports</h2>
   <p className="text-sm text-muted-foreground">A QuickBooks CSV is <strong>PREPARED / possibly imported</strong> until an owner records a witnessed outcome. Downloading alone never confirms import, and QuickBooks is not connected.</p>
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
       <td className="p-2 tabular-nums">{batch.entryCount}{batch.accountingDelivery&&<p className="text-xs">{batch.accountingDelivery.status.replaceAll("_"," ")}</p>}</td>
       <td className="p-2"><Link className="underline" href={`/desk/books/exports/download/${encodeURIComponent(batch.id)}`}>Download CSV</Link></td>
     </tr>)}</tbody>
    </table></div>}
  </section>

  <section aria-labelledby="qbo-delivery-review" className="space-y-3 rounded-lg border border-border p-4">
   <h2 id="qbo-delivery-review" className="text-lg font-semibold">QuickBooks import and delivery review</h2>
   <p className="text-sm text-muted-foreground">A file can have been imported remotely even when Appliance Desk cannot see it. Prepared or unverified exports block another overlapping file. Only mark failed-before-import if you know no QuickBooks upload started. Imported files remain archived; do not upload them twice.</p>
   {history.filter(x=>x.target==="QBO_JOURNAL_CSV").length===0?<p>No QuickBooks journal exports yet.</p>:
    <div className="space-y-4">{history.filter(x=>x.target==="QBO_JOURNAL_CSV").map(batch=>
     <article key={batch.id} className="space-y-2 rounded border border-border p-3">
      <h3 className="font-semibold break-all">{batch.fileName}</h3>
      <p>{batch.entryCount} journal sources · {formatBusinessDate(batch.periodFrom)} through {formatBusinessDate(batch.periodTo)}</p>
      <p className="font-medium">{batch.accountingDelivery?
        (batch.accountingDelivery.status==="PREPARED"?"PREPARED — import outcome uncertain":
        batch.accountingDelivery.status.replaceAll("_"," ")):
        "Legacy batch — import status unknown"}</p>
      {batch.accountingDelivery&&<p className="text-sm text-muted-foreground">
        Company: {batch.accountingDelivery.tenantLabel} · Edition: {batch.accountingDelivery.edition}
        {batch.accountingDelivery.memo?" · Owner decision retained":""}</p>}
      {batch.accountingDelivery&&["IMPORT_CONFIRMED","RECONCILIATION_CONFIRMED"].includes(batch.accountingDelivery.status)&&
        <p role="status">Already imported — re-download for audit only, do not upload again.</p>}
      {session.user.role==="OWNER"&&!batch.accountingDelivery&&
       <form action={registerQboDeliveryAction} className="grid gap-2 sm:grid-cols-2">
        <input type="hidden" name="batchId" value={batch.id}/>
        <label>Company or trial tenant<input className={input} name="tenantLabel" minLength={3} maxLength={100} required/></label>
        <label>Edition<select className={input} name="edition" defaultValue="OTHER">
         <option value="FREE">Free</option><option value="SIMPLE_START">Simple Start</option>
         <option value="ESSENTIALS">Essentials</option><option value="PLUS">Plus</option><option value="OTHER">Other</option>
        </select></label>
        <p className="sm:col-span-2 text-sm">Registration only labels this older archive as uncertain. It does not prove import or allow another file.</p>
        <button className={button} type="submit">Register legacy archive for review</button>
       </form>}
      {session.user.role==="OWNER"&&batch.accountingDelivery&&["PREPARED","IMPORT_CONFIRMED"].includes(batch.accountingDelivery.status)&&
       <form action={decideQboDeliveryAction} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="deliveryId" value={batch.accountingDelivery.id}/>
        <input type="hidden" name="expectedVersion" value={batch.accountingDelivery.version}/>
        <label className="sm:col-span-2">Manual QuickBooks decision<select className={input} name="decision" defaultValue={batch.accountingDelivery.status==="PREPARED"?"UNCERTAIN":"RECONCILIATION_CONFIRMED"}>
         {batch.accountingDelivery.status==="PREPARED"?<>
           <option value="UNCERTAIN">Keep uncertain — no second import</option>
           <option value="IMPORT_CONFIRMED">Imported and trial bank comparison checked</option>
           <option value="FAILED_BEFORE_IMPORT">Failed before any import began</option>
          </>:<option value="RECONCILIATION_CONFIRMED">Trial statement comparison confirmed</option>}
        </select></label>
        <label className="sm:col-span-2">Private trial-company report / evidence reference<input name="reference" minLength={8} maxLength={180} className={input} required/></label>
        <label className="sm:col-span-2">Owner review and reason<textarea name="note" minLength={12} maxLength={700} className={input} required/></label>
        <label>Journal entries observed in the trial company<input type="number" name="importedCount" min={0} defaultValue={batch.entryCount} className={input}/></label>
        <label className="flex items-start gap-2"><input type="checkbox" name="balanced" className="mt-1"/>Trial journal debits and credits balance</label>
        <label className="flex items-start gap-2"><input type="checkbox" name="bankMatched" className="mt-1"/>Individual bank journal matches checked</label>
        <label className="flex items-start gap-2"><input type="checkbox" name="statementChecked" className="mt-1"/>Trial statement balance checked</label>
        <label className="flex items-start gap-2"><input type="checkbox" name="neverStarted" className="mt-1"/>For failed-before-import only: no upload ever started</label>
        <div className="sm:col-span-2"><button className={button} type="submit">Save owner import decision</button></div>
       </form>}
     </article>)}</div>}
  </section>
  <section aria-labelledby="qbo-manual-checklist" className="space-y-2 rounded-lg border border-border p-4">
   <h2 id="qbo-manual-checklist" className="text-lg font-semibold">Trial-company import checklist</h2>
   <ol className="list-decimal pl-6 space-y-1">
    <li>Check the actual QuickBooks edition permits Journal Entries import. An advertised Free edition is not verified by this screen.</li>
    <li>Match the chart of accounts by names, including Parent:Child for subaccounts. Prepare DETAIL CSV.</li>
    <li>In QuickBooks, use Settings → Import Data → Journal Entries; map journal number, date, account, description, debits and credits before import.</li>
    <li>Compare imported entry count and balanced journal amounts, then the bank register and statement beginning/ending balance. Capture private trial-company report reference.</li>
    <li>If the import may have started but the outcome is uncertain, keep PREPARED and investigate inside QuickBooks rather than preparing a duplicate CSV.</li>
   </ol>
   <p className="text-sm text-muted-foreground">No QuickBooks API, bank transfer or accounting close happens here; an owner-attested test is not independently verified real-account acceptance.</p>
  </section>
 </div>;
}
