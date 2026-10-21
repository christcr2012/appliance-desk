import Link from "next/link";
import { randomUUID } from "node:crypto";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney,moneyInputValue } from "@/lib/money-ui";
import { getBudgetPlanning } from "@/domains/budget/planning";
import { saveBudgetCostPlanAction,saveBudgetTargetAction,settleBudgetCostAction,
 reverseBudgetCostAction,fundBudgetSuggestionAction } from "./actions";
const field="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const button="rounded border border-border bg-card px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2";
const money=(n:number|null)=>n===null?"Unknown":formatMoney(n);
/** Same authenticated /desk/books/budget route; this view never authorizes a payment. */
export async function BudgetPlanSection({userId,owner,notice}:{
 userId:string;owner:boolean;notice?:string}){
 const today=businessDateKey(new Date());
 let data:Awaited<ReturnType<typeof getBudgetPlanning>>|null=null,error:string|null=null;
 try{data=await getBudgetPlanning(userId,today);}
 catch(e){error=e instanceof Error?e.message:"Unable to read verified finance sources.";}
 return <div className="space-y-6">
  <header className="space-y-3">
   <Link className="underline p-2" href="/desk/books">Back to Books</Link>
   <h1 className="text-2xl font-bold">Budget — plan ahead</h1>
   <p>A bill is planned, not paid. A target is a savings suggestion, not money in your account. Actual payments are recorded only in Books. This screen never sends money or contacts a provider.</p>
   <nav aria-label="Budget views" className="flex flex-wrap gap-3">
    <Link href="/desk/books/budget" className="underline p-2">My money and bank checks</Link>
    <Link href="/desk/books/budget?tab=plan" aria-current="page" className="underline p-2">Plan ahead</Link>
    <Link href="/desk/books/closing" className="underline p-2">Cash forecast</Link>
    <Link href="/desk/books/reports" className="underline p-2">Review reports</Link>
   </nav>
   {notice&&<p role="status" className="rounded border border-border p-3">{notice}</p>}
  </header>
  {error&&<p role="alert" className="rounded border border-border p-4">{error} — No forecast or payment readiness is implied.</p>}
  {data&&<>
   <section className="rounded border border-border p-4 space-y-3">
    <h2 className="text-lg font-semibold">Actual bank backing — {data.sourceStatus}</h2>
    <p>Checked through {data.asOf}. Ready after protected tax, customer and card obligations: <strong>{money(data.readyCents)}</strong>. Protected requirements: {money(data.protectedCents)}. Neither estimated rent nor targets fund envelopes.</p>
    {!data.mayAssign&&<p role="alert">Funding remains disabled: {data.sourceReasons.slice(0,3).join(" ")||"Complete independent owner source review first."}</p>}
    <h3 className="font-semibold">Suggested allocation — review only</h3>
    {data.proposal.legs.length===0?<p>No eligible verified-cash allocation can be proposed. Savings goals remain editable.</p>:
     <ul className="list-disc pl-5">{data.proposal.legs.map(x=><li key={x.envelopeId}>
      {data.envelopes.find(e=>e.id===x.envelopeId)?.name}: {money(x.beforeCents)} → {money(x.afterCents)}; proposal {money(x.signedCents)}
     </li>)}</ul>}
    <p>Still needed for goals/bills: {money(data.proposal.unfundedCents)}. Source revalidation is mandatory at confirmation.</p>
    {owner&&data.mayAssign&&data.proposal.legs.length>0&&
     <form action={fundBudgetSuggestionAction} className="grid gap-3">
      <input type="hidden" name="asOf" value={data.asOf}/>
      <input type="hidden" name="hash" value={data.sourceHash}/>
      <input type="hidden" name="revision" value={data.revision}/>
      <input type="hidden" name="key" value={randomUUID()}/>
      <input type="hidden" name="legs" value={JSON.stringify(data.proposal.legs.map(x=>({
       envelopeId:x.envelopeId,signedCents:x.signedCents
      })))}/>
      <label>Owner funding review reason<input required minLength={12} maxLength={300} name="reason" className={field}/></label>
      <button className={button}>Confirm this exact virtual allocation — never a bank transfer</button>
     </form>}
   </section>
   <section className="space-y-3">
    <h2 className="text-lg font-semibold">My envelopes and targets</h2>
    <div className="grid gap-3 lg:grid-cols-2">{data.envelopes.filter(x=>x.active).map(env=><article key={env.id} className="rounded border border-border p-4 space-y-2">
     <h3 className="font-semibold">{env.name}</h3>
     <p>Saved now {money(env.balanceCents)} · Unpaid soon {money(env.unpaidUpcomingCents)} · More needed {money(env.needCents)}.</p>
     <p>{env.target?env.target.kind.replaceAll("_"," ").toLowerCase():"No savings target"} · suggested this month {money(env.monthlySuggestionCents)} · {env.nextGoalDueOn??"No fixed due date"}</p>
     {owner&&<form action={saveBudgetTargetAction} className="grid gap-2">
      <input type="hidden" name="envelopeId" value={env.id}/>
      {env.target&&<input type="hidden" name="version" value={env.target.version}/>}
      <label>Target type<select name="kind" className={field} defaultValue={env.target?.kind??"MAINTAIN_BALANCE"}>
       <option value="MAINTAIN_BALANCE">Keep at least this much</option>
       <option value="MONTHLY_SPEND">Monthly spending capacity</option>
       <option value="SAVE_BY_DATE">Save for a due date</option>
      </select></label>
      <label>Target amount ($)<input name="amount" inputMode="decimal" className={field}
       defaultValue={moneyInputValue(env.target?.amountCents??0)} required/></label>
      <label>Due date (required only for Save by date)<input name="dueOn" type="date" className={field} defaultValue={env.target?.dueOn??""}/></label>
      <label>Repeat<select name="repeat" className={field} defaultValue={env.target?.repeat??"NONE"}>
       <option value="NONE">One-time or ongoing</option><option value="ANNUAL">Annual savings deadline</option>
      </select></label>
      <label>Reviewed decision<input name="reason" className={field} minLength={12} maxLength={300} required/></label>
      <button className={button}>Save target (does not assign cash)</button>
     </form>}
    </article>)}</div>
   </section>
   <section className="rounded border border-border p-4 space-y-3">
    <h2 className="text-lg font-semibold">Known future costs</h2>
    <p>Exact bills and owner estimates shown separately through {data.through}. Past due amounts are still unpaid until a verified posted Books source is linked.</p>
    {owner&&<form action={saveBudgetCostPlanAction} className="grid gap-3 sm:grid-cols-2">
     <label>Bill name<input name="name" className={field} maxLength={200} required/></label>
     <label>Envelope<select name="envelopeId" className={field}>{data.envelopes.filter(x=>x.active).map(e=>
      <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
     <label>Amount ($)<input name="amount" className={field} inputMode="decimal" required/></label>
     <label>Amount confidence<select name="quality" className={field}><option value="ESTIMATE">Estimate</option><option value="EXACT">Exact known cost</option></select></label>
     <label>First due date<input type="date" min={today} name="dueOn" defaultValue={today} className={field} required/></label>
     <label>Repeats<select name="recurrence" className={field}>
      <option value="NONE">Once</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annually</option>
     </select></label>
     <label className="sm:col-span-2">Reason for adding this cost<input name="reason" minLength={12} maxLength={300} required className={field}/></label>
     <button className={button}>Save planned cost only — do not pay</button>
    </form>}
    {data.upcoming.length?data.upcoming.map(item=><article key={item.id} className="rounded border border-border p-3 space-y-2">
     <h3 className="font-semibold">{item.name} · {money(item.amountCents)} · {item.quality}</h3>
     <p>Due {item.dueOn} · {item.envelopeName} · {item.status} · paid from verified sources {money(item.paidCents)} · unpaid {money(item.unpaidCents)}</p>
     {owner&&item.unpaidCents>0&&<details className="rounded border border-border p-2"><summary className="cursor-pointer">Link an existing posted Books expense, not a new charge</summary>
      <form action={settleBudgetCostAction} className="grid gap-2 pt-2">
       <input type="hidden" name="occurrenceId" value={item.id}/><input type="hidden" name="revision" value={data.revision}/><input type="hidden" name="key" value={randomUUID()}/>
       <label>Posted Books expense ID<input name="expenseId" className={field} required/></label>
       <label>Paid amount ($)<input name="amount" inputMode="decimal" className={field} defaultValue={moneyInputValue(item.unpaidCents)} required/></label>
       <label>Source and reason<input name="reason" className={field} minLength={12} maxLength={300} required/></label>
       <button className={button}>Link verified posted expense to this bill</button>
      </form>
      <Link className="underline p-2 inline-block" href="/desk/books/expenses">Find posted expense in Books</Link>
     </details>}
     {owner&&item.settlements.map(link=><details key={link.id} className="rounded border border-border p-2">
      <summary className="cursor-pointer">Correct linked posted source {link.sourceId} ({money(link.amountCents)})</summary>
      <form action={reverseBudgetCostAction} className="grid gap-2 pt-2">
       <input type="hidden" name="settlementId" value={link.id}/><input type="hidden" name="revision" value={data.revision}/><input type="hidden" name="key" value={randomUUID()}/>
       <label>Reason for reversing this planning link<input name="reason" className={field} minLength={12} maxLength={300} required/></label>
       <button className={button}>Reverse only this plan link, preserve Books history</button>
      </form>
     </details>)}
    </article>):<p>No dated planned bills have been generated. Create a known future cost to see a schedule.</p>}
   </section>
  </>}
 </div>;
}
