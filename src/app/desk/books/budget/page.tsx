import Link from "next/link";
import { BudgetPlanSection } from "./plan-section";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/session";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney, moneyInputValue, parseDollarInput } from "@/lib/money-ui";
import { getBudgetSnapshot } from "@/domains/budget/protected";
import { getBudgetWindows } from "@/domains/budget/envelopes";
import { getPostedBankSpendingDesk,getSupplierRefundDesk } from "@/domains/budget/spending";
import { attestBudgetAction,activateBudgetAction,budgetMoveAction,assignSpendingAction,reverseSpendingAction,
 editEnvelopeAction,configureWindowsAction,transferBudgetAction,applyRefundAction } from "./actions";
export const metadata={title:"Budget backing — Books"};
const input="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const btn="rounded border border-border bg-card px-3 py-2 font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2";
const dollars=(n:number|null)=>n===null?"Unknown":formatMoney(n);
export default async function BudgetBackingPage({searchParams}:{
 searchParams:Promise<{tab?:string;days?:string;view?:string;state?:string;notice?:string;refreshCursor?:string;previewKind?:string;envelopeId?:string;
 fromId?:string;toId?:string;amount?:string;reason?:string}>}){
 const actor=await requireRole("OWNER","ADMIN"),owner=actor.user.role==="OWNER";
 const params=await searchParams;
 if(params.tab==="plan")return <BudgetPlanSection userId={actor.user.id} owner={owner}
  notice={params.notice?.slice(0,240)} days={params.days} view={params.view}
  state={params.state} refreshCursor={params.refreshCursor?.slice(0,64)}/>;
 const asOf=businessDateKey(new Date());
 const [snap,spending,windows,refunds]=await Promise.all([getBudgetSnapshot(actor.user.id,asOf),
   getPostedBankSpendingDesk(actor.user.id),getBudgetWindows(actor.user.id),getSupplierRefundDesk(actor.user.id)]);
 const notice=params.notice?.slice(0,240);
 type PreviewLeg={id:string;signedCents:number;kind:"ASSIGN"|"RELEASE"};
 let preview:null|{kind:string;legs:PreviewLeg[];amount:number;reason:string;
  problem:string|null;before:number;after:number|null;changed:Array<{id:string;
  name:string;prior:number;next:number}>;fromId:string;toId:string}=null;
 if(owner&&["ASSIGN","RELEASE","TRANSFER"].includes(params.previewKind??"")){
  const kind=params.previewKind!,fromId=params.fromId??"",
   toId=params.toId??"",envelopeId=params.envelopeId??"";
  let amount=0,problem:string|null=null;
  try{amount=parseDollarInput(params.amount??"",2_000_000_000);
   if(amount<=0)problem="Choose a positive whole-cent amount.";
  }catch{problem="Enter a supported dollars-and-cents amount.";}
  const reason=(params.reason??"").trim();
  if(reason.length<12||reason.length>300)problem="Explain the reviewed financial change.";
  const legs:PreviewLeg[]=kind==="TRANSFER"?
   [{id:fromId,signedCents:-amount,kind:"RELEASE"},
    {id:toId,signedCents:amount,kind:"ASSIGN"}]:
   [{id:envelopeId,signedCents:kind==="RELEASE"?-amount:amount,
     kind:kind==="RELEASE"?"RELEASE":"ASSIGN"}];
  const choices=new Map(snap.envelopes.map(x=>[x.id,x]));
  const after=new Map(snap.envelopes.map(x=>[x.id,x.balanceCents]));
  if(kind==="TRANSFER"&&(!fromId||!toId||fromId===toId))
   problem="Choose two distinct active envelopes.";
  for(const leg of legs){
   const row=choices.get(leg.id),before=after.get(leg.id);
   if(!row?.active||before===undefined){problem="Choose an active envelope.";continue;}
   if(leg.kind==="RELEASE"&&before< -leg.signedCents)
    problem="The source envelope does not have enough positive funding.";
   after.set(leg.id,before+leg.signedCents);
  }
  const afterBacked=[...after.values()].reduce((total,n)=>total+Math.max(0,n),0);
  const readyAfter=snap.eligibleBankCents===null?null:
   snap.eligibleBankCents-snap.protectedTotalCents-afterBacked;
  if(afterBacked>snap.discretionaryBackedCents&&(!snap.mayAssign||
    readyAfter===null||readyAfter<0))
   problem="A new assignment would exceed verified unprotected cash.";
  if(snap.envelopes.some(x=>x.balanceCents<0)&&legs.some(x=>x.kind==="ASSIGN"&&
   (choices.get(x.id)?.balanceCents??0)>=0))
   problem="Cover negative envelopes before funding another.";
  preview={kind,legs,amount,reason,problem,before:snap.readyCents??0,after:readyAfter,
   fromId,toId,changed:legs.map(x=>({id:x.id,name:choices.get(x.id)?.name??"Unknown",
     prior:choices.get(x.id)?.balanceCents??0,
     next:after.get(x.id)??0}))};
 }
 return <div className="space-y-6">
  <header className="space-y-2">
   <Link className="underline" href="/desk/books/cash/checks">Back to bank statement reconciliation</Link>
   <h1 className="text-2xl font-bold">Budget backing</h1>
   <nav aria-label="Budget views" className="flex flex-wrap gap-3">
    <Link className="underline p-2" href="/desk/books/budget" aria-current="page">My money</Link>
    <Link className="underline p-2" href="/desk/books/budget?tab=plan">Plan ahead</Link>
    <Link className="underline p-2" href="/desk/books/reports">Review</Link>
    <Link className="underline p-2" href="/desk/books/cash/checks">Bank checks</Link>
    <Link className="underline p-2" href="/desk/books/budget#source-setup">Setup</Link>
   </nav>
   <p>Discretionary envelopes do not move money out of the bank. Protected tax, card and customer obligations are reserved first. A CSV or estimated rent is never spendable cash.</p>
   {notice&&<p role="status" className="rounded border border-border p-3">{notice}</p>}
  </header>
  {owner&&preview&&<section id="funding-preview" className="rounded-lg border border-border p-4 space-y-3">
   <h2 className="text-lg font-semibold">Review before and after — no change has been submitted</h2>
   <p>The displayed balance and protection calculations are read-only. Confirming rechecks the exact revision and source evidence inside one serializable transaction; if something changes, nothing is moved.</p>
   <p>Current unprotected ready balance: {dollars(snap.readyCents)}. After proposal: {dollars(preview.after)}.</p>
   {preview.changed.map(row=><p key={row.id}>{row.name}: {formatMoney(row.prior)} → {formatMoney(row.next)}</p>)}
   {preview.problem?<p role="alert">{preview.problem} The proposed movement cannot be confirmed.</p>:
    <p role="status">The current snapshot supports this proposed virtual envelope movement. This does not approve any bank payment.</p>}
   <form action={preview.kind==="TRANSFER"?transferBudgetAction:budgetMoveAction} className="space-y-3">
    <input type="hidden" name="asOf" value={asOf}/>
    <input type="hidden" name="revision" value={snap.stateRevision}/>
    <input type="hidden" name="hash" value={snap.sourceHash}/>
    <input type="hidden" name="key" value={randomUUID()}/>
    <input type="hidden" name="amount" value={moneyInputValue(preview.amount)}/>
    <input type="hidden" name="reason" value={preview.reason}/>
    {preview.kind==="TRANSFER"?<>
     <input type="hidden" name="fromId" value={preview.fromId}/>
     <input type="hidden" name="toId" value={preview.toId}/>
    </>:<>
     <input type="hidden" name="kind" value={preview.kind}/>
     <input type="hidden" name="envelopeId" value={preview.legs[0]?.id??""}/>
    </>}
    <button className={btn} disabled={Boolean(preview.problem)}>Confirm this exact reviewed envelope proposal</button>
   </form>
   <Link href="/desk/books/budget" className="inline-block underline p-2">Cancel and return to balances</Link>
  </section>}
  <section className="rounded-lg border border-border p-4 space-y-2">
   <h2 className="text-lg font-semibold">Cash ready to assign — {snap.status}</h2>
   <p role="status">Budget setup is {snap.enabled?"ON":"OFF"}. Funding approval: {snap.mayAssign?"Source conditions verified":"NOT AUTHORIZED"}.</p>
   <p className="text-sm text-muted-foreground">Evidence date: {snap.asOf}. Source hash: <span className="break-all">{snap.sourceHash}</span>. The check is tied to the latest Books posting revision, bank/account review and protected liabilities.</p>
   <div className="grid gap-2 sm:grid-cols-2">
    <p>Source-backed bank cash: <strong>{dollars(snap.eligibleBankCents)}</strong></p>
    <p>Protected customer, tax and card debt: <strong>{formatMoney(snap.protectedTotalCents)}</strong></p>
    <p>Funded discretionary envelopes: <strong>{formatMoney(snap.discretionaryBackedCents)}</strong></p>
    <p>Remaining after protections (not bank permission to spend): <strong>{dollars(snap.readyCents)}</strong></p>
   </div>
   <h3 className="font-semibold">Why assignments are blocked or need attention</h3>
   {snap.reasons.length?<ul className="list-disc pl-5 space-y-1">{snap.reasons.map((x,i)=><li key={i}>{x}</li>)}</ul>:
    <p>No remaining calculation warnings. Always independently check a bank before an actual purchase or payment.</p>}
   <h3 className="font-semibold">Bank evidence</h3>
   {snap.bankEvidence.length?snap.bankEvidence.map(b=><p key={b.id}>{b.name} · statement through {b.statementTo??"unknown"} · adjusted {dollars(b.eligibleCents)} · unmatched rows {b.unmatchedCount}</p>):
    <p>No bank accounts are registered.</p>}
  </section>
  <section className="rounded-lg border border-border p-4 space-y-2">
   <h2 className="text-lg font-semibold">Required protected obligations</h2>
   <p>Customer deposits/credits are protected first, then tax and Colorado delivery fees, then business-card debt. A filing is not proof that tax was paid.</p>
   {snap.protectedLiabilities.length?snap.protectedLiabilities.map(x=><p key={x.accountId}>
    {x.name}: required {formatMoney(x.requiredCents)} · currently backed {formatMoney(x.fundedCents)} · shortage {formatMoney(x.shortageCents)}
   </p>):<p>No classified liabilities were available; that does not establish absence of debt.</p>}
   {snap.unknownLiabilities.length>0&&<p role="alert">Unclassified liabilities: {snap.unknownLiabilities.join(", ")}</p>}
  </section>
  {owner&&<section id="source-setup" className="rounded-lg border border-border p-4 space-y-3">
   <h2 className="text-lg font-semibold">Owner review and activation</h2>
   <p>Record references to independent bank statements, the current business-card debt and customer/tax liability review. No account or card numbers, passwords or unreviewed guessed amounts. This review expires when the day or journal changes.</p>
   <form action={attestBudgetAction} className="grid gap-3">
    <input type="hidden" name="asOf" value={asOf}/><input type="hidden" name="revision" value={snap.stateRevision}/>
    <label>Actual bank statement reference<input name="bankReference" minLength={12} maxLength={250} required className={input}/></label>
    <label>Current card balance/debt source<input name="cardReference" minLength={12} maxLength={250} required className={input}/></label>
    <label>Customer deposits, refunds, sales/use tax and fee obligations source<input name="liabilityReference" minLength={12} maxLength={250} required className={input}/></label>
    <label className="flex gap-2 items-start"><input type="checkbox" name="confirmed" value="confirmed" required/>
     <span>I independently checked every active bank account and known protected obligation through today, with no omitted business card or pending customer refund.</span></label>
    <button className={btn}>Save dated owner source review (does not enable funding)</button>
   </form>
   <form action={activateBudgetAction} className="grid gap-3 sm:grid-cols-2">
    <input type="hidden" name="revision" value={snap.stateRevision}/>
    <label>Budget start date<input type="date" max={asOf} name="date" defaultValue={asOf} required className={input}/></label>
    <label>Requested setting<select name="enabled" className={input} defaultValue={snap.enabled?"true":"false"}>
     <option value="false">OFF (drafts only)</option><option value="true">ON (only after evidence passes)</option>
    </select></label>
    <label className="sm:col-span-2">Owner decision and source explanation<input name="reason" minLength={12} maxLength={300} required className={input}/></label>
    <button className={btn}>Review and save budget setting</button>
   </form>
  </section>}
  {owner&&<section className="rounded-lg border border-border p-4 space-y-3">
   <h2 className="text-lg font-semibold">Owner review windows</h2>
   <p>Settings affect source-review warnings and later planning horizons; they do not waive statement matching or protected obligations.</p>
   <form action={configureWindowsAction} className="grid gap-3 sm:grid-cols-2">
    <input type="hidden" name="revision" value={snap.stateRevision}/>
    <label>Maximum age of bank evidence (1–90 days)<input type="number" name="bankAge" min={1} max={90} defaultValue={windows.bankEvidenceMaxAgeDays} className={input} required/></label>
    <label>Planning horizon (30–365 days)<input type="number" name="horizon" min={30} max={365} defaultValue={windows.budgetPlanningHorizonDays} className={input} required/></label>
    <label>Upcoming expense window (1–90 days)<input type="number" name="upcoming" min={1} max={90} defaultValue={windows.budgetUpcomingWindowDays} className={input} required/></label>
    <label>Reminder lead time (0–90 days)<input type="number" name="lead" min={0} max={90} defaultValue={windows.budgetReminderLeadDays} className={input} required/></label>
    <label className="sm:col-span-2">Owner review reason<input name="reason" className={input} minLength={12} maxLength={300} required/></label>
    <button className={btn}>Save reviewed settings</button>
   </form>
  </section>}
  <section className="rounded-lg border border-border p-4 space-y-3">
   <h2 className="text-lg font-semibold">Posted business spending — classification only</h2>
   <p>Review existing Books bank outflows, not imported CSV duplicates. A real expense can post even when there is no envelope balance. This form only labels that posted debit; it cannot create a payment or bank transaction. Protected tax/card/deposit repayments are not discretionary spending.</p>
   <p role="status">{snap.unassignedCount} unclassified business bank outflow(s); outstanding classification {formatMoney(snap.unassignedCents)}.</p>
   {!spending.length?<p>No recent discretionary bank outflows were found.</p>:spending.map(s=><article key={s.id} className="rounded border border-border p-3 space-y-2">
    <h3 className="font-semibold">{s.entry.memo} · {formatMoney(s.amountCents)}</h3>
    <p className="text-xs break-all">Books bank journal line {s.id} · {s.bookDate} · {s.splits.length?"Classified":"Needs classification"}</p>
    {s.splits.map(x=><p key={x.id}>Assigned to {x.envelope.name}: {formatMoney(x.amountCents)}</p>)}
    {owner&&!s.splits.length&&<form action={assignSpendingAction} className="grid gap-2 sm:grid-cols-2">
     <input type="hidden" name="journalLineId" value={s.id}/><input type="hidden" name="key" value={randomUUID()}/>
     <label>Discretionary envelope<select name="envelopeId" className={input} required>
      {snap.envelopes.filter(e=>e.active).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
     </select></label>
     <label>Original posted amount ($)<input name="amount" className={input} defaultValue={moneyInputValue(s.amountCents)} required/></label>
     <label className="sm:col-span-2">Classification source and reason<input name="reason" className={input} minLength={12} maxLength={300} required/></label>
     <button className={btn}>Classify original posted bank expense (no new payment)</button>
    </form>}
    {owner&&s.splits.length>0&&<form action={reverseSpendingAction} className="grid gap-2">
     <input type="hidden" name="journalLineId" value={s.id}/>
     <input type="hidden" name="revision" value={snap.stateRevision}/><input type="hidden" name="key" value={randomUUID()}/>
     <label>Why the classification must be corrected<input name="reason" minLength={12} maxLength={300} className={input} required/></label>
     <button className={btn}>Reverse classification with audit history</button>
    </form>}
   </article>)}
  </section>
  <section className="rounded-lg border border-border p-4 space-y-3">
   <h2 className="text-lg font-semibold">Cleared supplier refunds — return original envelope funding</h2>
   <p>Only real matched business-bank receipts credited against an expense may restore the exact original expense envelope. Customer refunds, card payments and un-cleared receipts are excluded.</p>
   {owner&&refunds.clearedRefunds.length>0&&refunds.originals.length>0?
   <form action={applyRefundAction} className="grid gap-2 sm:grid-cols-2">
    <input type="hidden" name="revision" value={snap.stateRevision}/><input type="hidden" name="key" value={randomUUID()}/>
    <label>Cleared supplier bank receipt<select name="refundLineId" className={input}>
     {refunds.clearedRefunds.map(r=><option key={r.id} value={r.id}>{r.reference} · {formatMoney(r.amountCents)}</option>)}
    </select></label>
    <label>Original classified expense<select name="originalSpendId" className={input}>
     {refunds.originals.map(r=><option key={r.id} value={r.id}>{r.envelope} · up to {formatMoney(r.remainingCents)} · {r.id}</option>)}
    </select></label>
    <label>Refund to restore ($)<input className={input} name="amount" inputMode="decimal" required/></label>
    <label>Independent source and correction reason<input name="reason" className={input} minLength={12} maxLength={300} required/></label>
    <button className={btn}>Return cleared refund to original envelope (no bank transfer)</button>
   </form>:<p>No independently cleared, eligible supplier refund and original expense pair is available.</p>}
  </section>
  {owner&&<section className="rounded-lg border border-border p-4 space-y-3">
   <h2 className="text-lg font-semibold">Transfer already-funded cash between envelopes</h2>
   <p>One atomic reviewed command releases the source and assigns the same amount to the destination. This is not a bank transfer and cannot move customer, tax or card reserves.</p>
   <form action="/desk/books/budget" method="get" className="grid gap-2 sm:grid-cols-2">
    <input type="hidden" name="previewKind" value="TRANSFER"/>
    <input type="hidden" name="asOf" value={asOf}/><input type="hidden" name="revision" value={snap.stateRevision}/>
    <input type="hidden" name="hash" value={snap.sourceHash}/><input type="hidden" name="key" value={randomUUID()}/>
    <label>From envelope<select name="fromId" className={input}>
     {snap.envelopes.filter(e=>e.active&&e.balanceCents>0).map(e=><option key={e.id} value={e.id}>{e.name} · {formatMoney(e.balanceCents)}</option>)}
    </select></label>
    <label>To envelope<select name="toId" className={input}>
     {snap.envelopes.filter(e=>e.active).map(e=><option key={e.id} value={e.id}>{e.name} · {formatMoney(e.balanceCents)}</option>)}
    </select></label>
    <label>Amount ($)<input name="amount" inputMode="decimal" className={input} required/></label>
    <label>Reviewed transfer reason<input name="reason" minLength={12} maxLength={300} className={input} required/></label>
    <button className={btn}>Preview two-sided balances before transfer</button>
   </form>
  </section>}
  <section className="rounded-lg border border-border p-4 space-y-4">
   <h2 className="text-lg font-semibold">One shared set of discretionary envelopes</h2>
   <p>These balances carry forward between months. Releasing returns positive backing to the shared pool; assigning spends none of the bank cash by itself. Negative balances remain visible.</p>
   <div className="grid gap-3 md:grid-cols-2">{snap.envelopes.map(e=><article key={e.id} className="rounded border border-border p-3 space-y-2">
    <h3 className="font-semibold">{e.name}</h3>
    <p>{e.groupLabel} · {e.active?"Active":"Archived"} · balance {formatMoney(e.balanceCents)}</p>
    {owner&&<form action={editEnvelopeAction} className="grid gap-2">
     <input type="hidden" name="envelopeId" value={e.id}/><input type="hidden" name="version" value={e.version}/>
     <label>Label<input name="name" className={input} defaultValue={e.name} maxLength={120} required/></label>
     <label>Group<input name="groupLabel" className={input} defaultValue={e.groupLabel} maxLength={120} required/></label>
     <label>Order<input type="number" name="sortOrder" className={input} defaultValue={e.sortOrder} min={-9999} max={9999} required/></label>
     <label>Visibility<select name="active" className={input} defaultValue={e.active?"true":"false"}>
      <option value="true">Active</option><option value="false">Archived (requires zero balance)</option>
     </select></label>
     <label>Reason for change<input name="reason" className={input} minLength={12} maxLength={300} required/></label>
     <button className={btn}>Save envelope label and status</button>
    </form>}
    {owner&&e.active&&<form action="/desk/books/budget" method="get" className="grid gap-2">
     <input type="hidden" name="asOf" value={asOf}/><input type="hidden" name="revision" value={snap.stateRevision}/>
     <input type="hidden" name="hash" value={snap.sourceHash}/><input type="hidden" name="key" value={randomUUID()}/>
     <input type="hidden" name="envelopeId" value={e.id}/>
     <label>Move type<select className={input} name="previewKind">
      <option value="ASSIGN">Assign verified cash</option><option value="RELEASE">Release existing positive funding</option>
     </select></label>
     <label>Amount ($)<input name="amount" inputMode="decimal" className={input} required/></label>
     <label>Reason<input name="reason" className={input} minLength={12} maxLength={300} required/></label>
     <button className={btn}>Preview cash and envelope balances</button>
    </form>}
   </article>)}</div>
  </section>
 </div>;
}
