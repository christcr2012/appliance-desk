import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/session";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney, moneyInputValue } from "@/lib/money-ui";
import { getBudgetSnapshot } from "@/domains/budget/protected";
import { getPostedBankSpendingDesk } from "@/domains/budget/spending";
import { attestBudgetAction,activateBudgetAction,budgetMoveAction,assignSpendingAction,reverseSpendingAction } from "./actions";
export const metadata={title:"Budget backing — Books"};
const input="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const btn="rounded border border-border bg-card px-3 py-2 font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2";
const dollars=(n:number|null)=>n===null?"Unknown":formatMoney(n);
export default async function BudgetBackingPage({searchParams}:{
 searchParams:Promise<{notice?:string}>}){
 const actor=await requireRole("OWNER","ADMIN"),owner=actor.user.role==="OWNER";
 const asOf=businessDateKey(new Date());
 const [snap,spending]=await Promise.all([getBudgetSnapshot(actor.user.id,asOf),
   getPostedBankSpendingDesk(actor.user.id)]);
 const notice=(await searchParams).notice?.slice(0,240);
 return <div className="space-y-6">
  <header className="space-y-2">
   <Link className="underline" href="/desk/books/cash/checks">Back to bank statement reconciliation</Link>
   <h1 className="text-2xl font-bold">Budget backing</h1>
   <p>Discretionary envelopes do not move money out of the bank. Protected tax, card and customer obligations are reserved first. A CSV or estimated rent is never spendable cash.</p>
   {notice&&<p role="status" className="rounded border border-border p-3">{notice}</p>}
  </header>
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
  {owner&&<section className="rounded-lg border border-border p-4 space-y-3">
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
  <section className="rounded-lg border border-border p-4 space-y-4">
   <h2 className="text-lg font-semibold">One shared set of discretionary envelopes</h2>
   <p>These balances carry forward between months. Releasing returns positive backing to the shared pool; assigning spends none of the bank cash by itself. Negative balances remain visible.</p>
   <div className="grid gap-3 md:grid-cols-2">{snap.envelopes.map(e=><article key={e.id} className="rounded border border-border p-3 space-y-2">
    <h3 className="font-semibold">{e.name}</h3>
    <p>{e.groupLabel} · {e.active?"Active":"Archived"} · balance {formatMoney(e.balanceCents)}</p>
    {owner&&e.active&&<form action={budgetMoveAction} className="grid gap-2">
     <input type="hidden" name="asOf" value={asOf}/><input type="hidden" name="revision" value={snap.stateRevision}/>
     <input type="hidden" name="hash" value={snap.sourceHash}/><input type="hidden" name="key" value={randomUUID()}/>
     <input type="hidden" name="envelopeId" value={e.id}/>
     <label>Move type<select className={input} name="kind">
      <option value="ASSIGN">Assign verified cash</option><option value="RELEASE">Release existing positive funding</option>
     </select></label>
     <label>Amount ($)<input name="amount" inputMode="decimal" className={input} required/></label>
     <label>Reason<input name="reason" className={input} minLength={12} maxLength={300} required/></label>
     <button className={btn}>Previewed source-backed movement (atomic)</button>
    </form>}
   </article>)}</div>
  </section>
 </div>;
}
