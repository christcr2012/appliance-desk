import Link from "next/link";
import { randomUUID } from "node:crypto";
import { businessDateKey,addBusinessDays } from "@/lib/business-date";
import { formatMoney,moneyInputValue } from "@/lib/money-ui";
import { getBudgetPlanning } from "@/domains/budget/planning";
import { saveBudgetCostPlanAction,saveBudgetTargetAction,settleBudgetCostAction,
 reverseBudgetCostAction,fundBudgetSuggestionAction,refreshBudgetPlanHorizonAction } from "./actions";
const field="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const button="rounded border border-border bg-card px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2";
const money=(n:number|null)=>n===null?"Unknown":formatMoney(n);
/** Same authenticated /desk/books/budget route; this view never authorizes a payment. */
export async function BudgetPlanSection({userId,owner,notice,days,view,state}:{
 userId:string;owner:boolean;notice?:string;days?:string;view?:string;state?:string}){
 const today=businessDateKey(new Date());
 const dayWindow=days==="30"?30:90;
 const listView=view==="calendar"?"calendar":"list";
 const filter=state==="PAID"||state==="PART_PAID"||state==="UNPAID"?state:"ALL";
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
   <p className="text-sm">Planning source history: {data.recentChanges.length} recent audited budget edits. Existing external bank and Books posting history remain authoritative.</p>
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
    {owner&&<form action={refreshBudgetPlanHorizonAction} className="flex gap-2 items-center"><input type="hidden" name="today" value={today}/><button className={button}>Refresh dated plan horizon (no charge)</button></form>}
    <p>Exact bills and owner estimates shown separately through {data.through}. Past due amounts are still unpaid until a verified posted Books source is linked.</p>
    {owner&&<form action={saveBudgetCostPlanAction} className="grid gap-3 sm:grid-cols-2">
     <label>Bill name<input name="name" className={field} maxLength={200} required/></label>
     <label>Linked source type<select name="sourceType" className={field}>
      <option value="MANUAL">Manual known bill</option>
      <option value="RECURRING_EXPENSE">Existing recurring expense template</option>
      <option value="PURCHASE_ORDER">Existing purchasing commitment</option>
     </select></label>
     <label>Existing source ID (required for linked sources)
      <input name="sourceId" className={field} aria-describedby="linked-source-help"/></label>
     <p id="linked-source-help" className="text-sm sm:col-span-2">Linked recurring templates must match the saved amount, monthly day and recurrence. Source ID is from the source screen; no duplicate manual plan for the same source.</p>
     {data.recurringSources.length>0&&<details className="sm:col-span-2"><summary className="cursor-pointer">Existing monthly expense templates (read-only IDs)</summary>
       {data.recurringSources.map(s=><p key={s.id} className="text-xs break-all">{s.name}: {money(s.amountCents)} on day {s.dayOfMonth} — {s.id}</p>)}
      </details>
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
    <nav aria-label="Upcoming bill controls" className="flex flex-wrap gap-3">
     <Link className="underline p-2" href="/desk/books/budget?tab=plan&days=30">Next 30 days</Link>
     <Link className="underline p-2" href="/desk/books/budget?tab=plan&days=90">Next 90 days</Link>
     <Link className="underline p-2" href={"/desk/books/budget?tab=plan&days="+dayWindow+"&view=list"}>List</Link>
     <Link className="underline p-2" href={"/desk/books/budget?tab=plan&days="+dayWindow+"&view=calendar"}>Calendar</Link>
     {["ALL","UNPAID","PART_PAID","PAID"].map(kind=><Link key={kind} className="underline p-2" aria-current={filter===kind?"page":undefined}
      href={"/desk/books/budget?tab=plan&days="+dayWindow+"&view="+listView+"&state="+kind}>{kind==="ALL"?"All payment states":kind.toLowerCase()}</Link>)}
    </nav>
    <p className="text-sm">View: {listView}. The selected day window is clipped to the owner-configured planning horizon; overdue bills remain in the underlying plan history.</p>
    {data.taxPeriods.length>0&&<aside className="rounded border border-border p-3 space-y-2">
     <h3 className="font-semibold">Protected sales/use tax filing dates — read only</h3>
     {data.taxPeriods.map(x=><p key={x.id}>{x.name}: due {x.dueOn} · {x.status}. Amount/payment requires verified tax filing and bank sources. <Link href="/desk/sales-tax/returns" className="underline">Open authoritative tax return</Link></p>)}
    </aside>}
    <h3 className="font-semibold">Existing bill plans and revisions</h3>
    {data.plans.map(plan=><details key={plan.id} className="rounded border border-border p-3">
     <summary className="cursor-pointer">{plan.name} — {money(plan.amountCents)} {plan.amountQuality}, {plan.recurrence} · {plan.dueOn}</summary>
     <p className="text-sm">Source {plan.sourceType}, ID {plan.sourceId??"manual"}; revision {plan.version}. Changing future dates does not overwrite recorded partial payments.</p>
     {owner&&<form action={saveBudgetCostPlanAction} className="grid gap-2 sm:grid-cols-2 pt-2">
      <input name="planId" type="hidden" value={plan.id}/><input name="version" type="hidden" value={plan.version}/>
      <input name="sourceType" type="hidden" value={plan.sourceType}/>
      <input name="sourceId" type="hidden" value={plan.sourceId??""}/>
      <input name="envelopeId" type="hidden" value={plan.envelopeId}/>
      <label>Bill name<input name="name" className={field} defaultValue={plan.name} required/></label>
      <label>Amount ($)<input name="amount" inputMode="decimal" className={field} defaultValue={moneyInputValue(plan.amountCents)} required/></label>
      <label>Source quality<select name="quality" className={field} defaultValue={plan.amountQuality}>
       <option value="ESTIMATE">Estimate</option><option value="EXACT">Exact</option>
      </select></label>
      <label>Next original due anchor<input name="dueOn" type="date" className={field} defaultValue={plan.dueOn} required/></label>
      <label>Repeats<select name="recurrence" className={field} defaultValue={plan.recurrence}>
       <option value="NONE">Once</option><option value="MONTHLY">Monthly</option>
       <option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annually</option>
      </select></label>
      <label>Plan state<select name="active" className={field} defaultValue={plan.active?"true":"false"}>
       <option value="true">Active</option><option value="false">Canceled (retain any paid evidence)</option>
      </select></label>
      <label className="sm:col-span-2">Why this future cost is changing<input name="reason" className={field} minLength={12} maxLength={300} required/></label>
      <button className={button}>Save reviewed future cost revision</button>
     </form>}
    </details>)}
    {data.upcoming.filter(item=>item.dueOn<=businessDateKey(addBusinessDays(new Date(),dayWindow)) && (filter==="ALL" || (filter==="UNPAID" ? item.unpaidCents>0 : item.status===filter))).length?
     listView==="calendar"?<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{[...new Set(data.upcoming.filter(item=>item.dueOn<=businessDateKey(addBusinessDays(new Date(),dayWindow))&&(filter==="ALL"||(filter==="UNPAID"?item.unpaidCents>0:item.status===filter))).map(item=>item.dueOn))].map(day=><article key={day} className="rounded border border-border p-3">
      <h3 className="font-semibold">{day}</h3>
      {data.upcoming.filter(item=>item.dueOn===day&&(filter==="ALL"||(filter==="UNPAID"?item.unpaidCents>0:item.status===filter))).map(item=><p className="text-sm" key={item.id}>{item.name} · {money(item.unpaidCents)} remaining · {item.quality} · {item.status}</p>)}
      <Link href={"/desk/books/budget?tab=plan&days="+dayWindow+"&view=list"} className="underline">Open detailed linked-source actions</Link>
     </article>)}</div>:
     data.upcoming.filter(item=>item.dueOn<=businessDateKey(addBusinessDays(new Date(),dayWindow)) && (filter==="ALL" || (filter==="UNPAID" ? item.unpaidCents>0 : item.status===filter))).map(item=><article key={item.id} className="rounded border border-border p-3 space-y-2">
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
      <Link className="underline p-2 inline-block" href="/desk/expenses">Find posted expense in Books</Link>
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
   <section className="rounded border border-border p-4 space-y-2">
    <h2 className="text-lg font-semibold">Recent changes to my plan</h2>
    {data.recentChanges.length?data.recentChanges.map(x=><p key={x.id} className="text-sm">{new Date(x.createdAt).toLocaleDateString("en-US")} · {x.action.replaceAll("."," ")} · {x.entityType}</p>):<p>No recent audited budget edits.</p>}
   </section>
  </>}
 </div>;
}
