import Link from "next/link";
import { requireRole } from "@/lib/session";
import { formatMoney } from "@/lib/money-ui";
import { monthReview } from "@/domains/books/month-review";
import { monthKey } from "@/domains/books/depreciation";

export const metadata={title:"Review this month's books"};
const short=(n:number)=>formatMoney(n);
export default async function BooksMonthPage({params}:{params:Promise<{month:string}>}){
 const session=await requireRole("OWNER","ADMIN");
 const {month}=await params;
 let model:Awaited<ReturnType<typeof monthReview>>|null=null;
 let error:string|null=null;
 try{
  monthKey(month);
  model=await monthReview({id:session.user.id,
   role:session.user.role as "OWNER"|"ADMIN"},month);
 }catch(e){error=e instanceof Error?e.message:"Could not load your month review.";}
 const display=/^\\d{4}-(0[1-9]|1[0-2])$/.test(month)
  ?new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric",timeZone:"UTC"})
   .format(new Date(month+"-01T12:00:00Z")):month;
 return <div className="mx-auto max-w-4xl space-y-6">
  <Link href="/desk/books" className="underline">Back to Your books</Link>
  <header className="space-y-2">
   <h1 className="text-2xl font-bold">Review {display}&apos;s books</h1>
   <p className="text-muted-foreground">Four checks using actual recorded business evidence. Nothing here sends a payment or changes a ledger entry.</p>
  </header>
  {error&&<p role="alert" className="rounded border border-border p-4">{error}</p>}
  {model&&<>
   {model.status==="CLOSED"?<p role="status">Locked on {model.lockedAt?.toLocaleDateString("en-US")}. Earlier accounting entries remain immutable.</p>:
     <p role="status">This month is open until the owner reviews and locks it.</p>}
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
   <section className="rounded-lg border border-border p-4 space-y-2">
    <h2 className="font-semibold">Accountant package</h2>
    <p>Use Books accounting exports for the current immutable journal detail and profit report. Sending to a configured accountant requires explicit owner approval.</p>
    <Link href="/desk/books/exports" className="underline">Open accounting exports</Link>
    {model.accountantSentAt&&<p>Last email accepted: {model.accountantSentAt.toLocaleDateString("en-US")}</p>}
    {session.user.role!=="OWNER"&&<p>Ask the owner to lock this month or email the accountant.</p>}
   </section>
  </>}
 </div>;
}
