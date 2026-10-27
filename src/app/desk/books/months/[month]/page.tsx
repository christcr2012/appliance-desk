import Link from "next/link";
import { requireRole } from "@/lib/session";
import { formatMoney } from "@/lib/money-ui";
import { monthReview } from "@/domains/books/month-review";
import { monthKey } from "@/domains/books/depreciation";
import { lockReviewedMonthAction, sendAccountantMonthAction, accountantReviewSettingsAction, reopenMonthAction, createAdjustmentAction, reverseAdjustmentAction } from "../../actions";
import { listMonthAdjustments, listAdjustmentAccounts, reversedAdjustmentSourceIds } from "@/domains/books/adjustments";
import { formatBusinessDate } from "@/lib/business-date";

export const metadata={title:"Review this month's books"};
const short=(n:number)=>formatMoney(n);
export default async function BooksMonthPage({params,searchParams}:{params:Promise<{month:string}>;searchParams:Promise<{notice?:string}>}){
 const session=await requireRole("OWNER","ADMIN","ACCOUNTANT");
 const {month}=await params;
 const {notice}=await searchParams;
 let model:Awaited<ReturnType<typeof monthReview>>|null=null;
 let error:string|null=null;
 try{
  monthKey(month);
  model=await monthReview({id:session.user.id,
   role:session.user.role as "OWNER"|"ADMIN"|"ACCOUNTANT"},month);
 }catch(e){error=e instanceof Error?e.message:"Could not load your month review.";}
 const adjustments=model?await listMonthAdjustments(session.user.id,month).catch(()=>[]):[];
 const reversedIds=model?await reversedAdjustmentSourceIds(session.user.id).catch(()=>new Set<string>()):new Set<string>();
 const adjAccounts=model?await listAdjustmentAccounts(session.user.id).catch(()=>[]):[];
 const [year,monthNumber]=month.split("-").map(Number);
 const display=Number.isInteger(year)&&Number.isInteger(monthNumber)&&
  year>=1000&&year<=9999&&monthNumber>=1&&monthNumber<=12
  ?new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric",timeZone:"UTC"})
   .format(new Date(Date.UTC(year,monthNumber-1,1))):month;
 return <div className="mx-auto max-w-4xl space-y-6">
  <Link href="/desk/books" className="underline">Back to Your books</Link>
  <header className="space-y-2">
   <h1 className="text-2xl font-bold">Review {display}&apos;s books</h1>
   <p className="text-muted-foreground">Four checks using actual recorded business evidence. Nothing here sends a payment or changes a ledger entry.</p>
  </header>
  {notice&&<p role="status" className="rounded border border-border p-3">{notice.slice(0,400)}</p>}
  {error&&<p role="alert" className="rounded border border-border p-4">{error}</p>}
  {model&&<>
   {model.status==="CLOSED"?<p role="status">Locked on {model.lockedAt?.toLocaleDateString("en-US")}. Earlier accounting entries remain immutable.</p>:
     <p role="status">This month is open until it is reviewed and locked.</p>}
   <section aria-label="Four monthly checks" className="grid gap-3 sm:grid-cols-2">
    {Object.entries(model.checks).map(([key,check])=><article key={key}
      className="rounded-lg border border-border bg-background p-4 space-y-2">
     <h2 className="font-semibold">{check.label}</h2>
     <p className={check.ok?"text-ink":"text-warning-ink"}>{check.ok?"Ready":"Needs review"}</p>
     <p className="text-sm">{check.detail}</p>
    </article>)}
   </section>
   <section className="space-y-3 rounded-lg border border-border p-4">
    <h2 className="text-lg font-semibold">Your month in plain words</h2>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
     <div><dt>Billed</dt><dd className="font-bold tabular-nums">{short(model.profit.incomeCents)}</dd></div>
     <div><dt>Collected</dt><dd className="font-bold tabular-nums">{short(model.collectedCents)}</dd></div>
     <div><dt>Spent</dt><dd className="font-bold tabular-nums">{short(model.profit.expenseCents)}</dd></div>
     <div><dt>Profit</dt><dd className="font-bold tabular-nums">{short(model.profit.netProfitCents)}</dd></div>
    </dl>
    {model.priorProfit&&<p className="text-sm">Previous month profit: {short(model.priorProfit.netProfitCents)}. This month: {short(model.profit.netProfitCents)}.</p>}
    <h3 className="font-semibold">Your biggest expense categories</h3>
    {model.topCategories.length?<ul className="space-y-1">
     {model.topCategories.map(x=><li key={x.name} className="flex justify-between gap-4">
      <span className="min-w-0 break-words">{x.name}</span><span className="shrink-0">{short(x.amountCents)}</span>
     </li>)}
    </ul>:<p>No posted expense categories yet.</p>}
   </section>
   <section className="space-y-2 rounded-lg border border-border p-4">
    <h2 className="font-semibold">Payment source checks</h2>
    {model.bankStates.length?model.bankStates.map((x,i)=><p key={i}>{x.detail}{x.unmatchedCents!==0?" ("+short(x.unmatchedCents)+")":""}</p>):
      <p>No business bank statements have been connected yet.</p>}
    <p>{model.stripe.detail}</p>
   </section>
   {(session.user.role==="OWNER"||session.user.role==="ACCOUNTANT")&&<section className="rounded-lg border border-border p-4 space-y-3">
    <h2 className="font-semibold">Lock {display}</h2>
    {model.status==="CLOSED"?
      <form action={reopenMonthAction} className="space-y-3">
       <input type="hidden" name="month" value={month}/>
       <label className="block">Why do you need to reopen this month?
        <textarea name="reason" required maxLength={300} rows={2}
         className="w-full rounded border border-border bg-background px-3 py-2"/>
       </label>
       <button className="min-h-11 rounded border border-border px-4 py-2">Unlock month with an audit record</button>
      </form>:
      <form action={lockReviewedMonthAction} className="space-y-3">
       <input type="hidden" name="month" value={month}/>
       {!model.checks.sources.ok||!model.checks.equipment.ok?
        <p role="alert">Finish the source and equipment checks before locking; those two checks cannot be overridden.</p>:null}
       {!model.checks.costs.ok&&<label className="block">Explain the missing expense evidence
        <textarea name="expensesReason" required maxLength={300} rows={2}
         className="w-full rounded border border-border bg-background px-3 py-2"/>
       </label>}
       {!model.checks.payments.ok&&<label className="block">Explain why payment sources remain unmatched
        <textarea name="paymentsReason" required maxLength={300} rows={2}
         className="w-full rounded border border-border bg-background px-3 py-2"/>
       </label>}
       <button disabled={!model.checks.sources.ok||!model.checks.equipment.ok}
        className="min-h-11 rounded border border-border px-4 py-2 font-semibold disabled:opacity-50">
        Lock {display}
       </button>
      </form>}
   </section>}
   <section className="rounded-lg border border-border p-4 space-y-3">
    <h2 className="font-semibold">Adjusting entries</h2>
    <p className="text-sm">Corrections and year-end fixes are posted as new entries; the original records are never edited. Debits must equal credits. Only the owner can reverse an adjusting entry.</p>
    {adjustments.length?<ul className="space-y-2">{adjustments.map(entry=><li key={entry.id} className="border-t border-border py-2">
      <p className="font-medium">#{entry.entryNumber} · {formatBusinessDate(entry.entryDate)} · {entry.memo}{entry.eventKind==="MANUAL_ADJUSTMENT_REVERSED"?" (reversal)":""}</p>
      {entry.lines.map((line,i)=><p key={i} className="flex gap-3 justify-between text-sm"><span>{line.accountName}</span><span className="tabular-nums">{line.debitCents?formatMoney(line.debitCents)+" debit":formatMoney(line.creditCents)+" credit"}</span></p>)}
      {entry.eventKind==="MANUAL_ADJUSTMENT"&&(reversedIds.has(entry.sourceId)
        ?<p className="text-sm text-muted-foreground">Reversed by the owner.</p>
        :session.user.role==="OWNER"&&<form action={reverseAdjustmentAction}><input type="hidden" name="month" value={month}/><input type="hidden" name="entryId" value={entry.id}/><button className="min-h-11 rounded border border-border px-4 py-2">Reverse this entry</button></form>)}
    </li>)}</ul>:<p className="text-sm">No adjusting entries this month.</p>}
    {model.status!=="CLOSED"&&<form action={createAdjustmentAction} className="space-y-3 border-t border-border pt-3">
     <input type="hidden" name="month" value={month}/>
     <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">Date
       <input type="date" name="dateKey" required min={month+"-01"} max={new Date(Date.UTC(year,monthNumber,0)).toISOString().slice(0,10)} defaultValue={new Date(Date.UTC(year,monthNumber,0)).toISOString().slice(0,10)}
        className="w-full min-h-11 rounded border border-border bg-background px-3 py-2"/>
      </label>
      <label className="block">What is this for? (shows in the books)
       <input name="memo" required maxLength={500} className="w-full min-h-11 rounded border border-border bg-background px-3 py-2"/>
      </label>
     </div>
     {[0,1,2,3].map(i=><div key={i} className="grid gap-2 sm:grid-cols-3">
      <label className="block">Account
       <select name="lineAccount" className="w-full min-h-11 rounded border border-border bg-background px-3 py-2">
        <option value="">Choose an account</option>
        {adjAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
       </select>
      </label>
      <label className="block">Debit $<input name="lineDebit" inputMode="decimal" placeholder="0.00" className="w-full min-h-11 rounded border border-border bg-background px-3 py-2"/></label>
      <label className="block">Credit $<input name="lineCredit" inputMode="decimal" placeholder="0.00" className="w-full min-h-11 rounded border border-border bg-background px-3 py-2"/></label>
     </div>)}
     <button className="min-h-11 rounded border border-border px-4 py-2 font-semibold">Record adjusting entry</button>
    </form>}
   </section>
   <section className="rounded-lg border border-border p-4 space-y-3">
    <h2 className="font-semibold">Accountant package</h2>
    <p>Download both files to review with your accountant. Nothing is sent automatically.</p>
    <div className="flex flex-wrap gap-4">
     <Link className="underline" href={`/desk/books/months/${month}/download?file=journal`}>Download journal CSV</Link>
     <Link className="underline" href={`/desk/books/months/${month}/download?file=profit`}>Download profit CSV</Link>
    </div>
    {model.accountantSentAt&&<p>Last email accepted: {model.accountantSentAt.toLocaleDateString("en-US")}</p>}
    {session.user.role==="OWNER"&&model.accountantEmail&&
     <form action={sendAccountantMonthAction} className="space-y-2">
      <input type="hidden" name="month" value={month}/>
      <p>Destination: {model.accountantEmail}</p>
      <button className="min-h-11 rounded border border-border px-4 py-2 font-semibold">Email it to my accountant</button>
      <p className="text-sm">Sends only after you press the button. If the result is unknown, check with your accountant before retrying.</p>
     </form>}
    {session.user.role==="ADMIN"&&<p>Ask the owner to lock this month or email the accountant.</p>}
   </section>
   {session.user.role==="OWNER"&&<section className="rounded-lg border border-border p-4 space-y-3">
    <h2 className="font-semibold">Accountant and reminder settings</h2>
    <form action={accountantReviewSettingsAction} className="grid gap-3 sm:grid-cols-2">
     <input type="hidden" name="month" value={month}/>
     <label>Accountant email (optional)
      <input type="email" name="accountantEmail" maxLength={200}
       defaultValue={model.accountantEmail??""}
       className="w-full min-h-11 rounded border border-border bg-background px-3 py-2"/>
     </label>
     <label>Remind me by day (1–28)
      <input type="number" min={1} max={28} required name="reminderDay"
       defaultValue={model.reviewReminderDay}
       className="w-full min-h-11 rounded border border-border bg-background px-3 py-2"/>
     </label>
     <div className="sm:col-span-2 flex flex-wrap gap-2">
      <button className="min-h-11 rounded border border-border px-4 py-2">Save settings</button>

     </div>
    </form>
    <form action={accountantReviewSettingsAction} className="space-y-2">
     <input type="hidden" name="month" value={month}/>
     <input type="hidden" name="accountantEmail" value={model.accountantEmail??""}/>
     <input type="hidden" name="reminderDay" value="15"/>
     <button className="min-h-11 rounded border border-border px-4 py-2" type="submit">
      Restore recommended reminder (day 15)
     </button>
    </form>
    <p className="text-sm">The recommended reminder is day 15 after the previous month ends. Only the owner can change it.</p>
   </section>}
  </>}
 </div>;
}
