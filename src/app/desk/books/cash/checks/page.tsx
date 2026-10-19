import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getCashAccounts } from "@/domains/books/cash/accounts";
import { getBankMatchDesk } from "@/domains/books/cash/matches";
import { getCashReadiness } from "@/domains/books/cash/cash-readiness";
import { businessDateKey,formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { confirmMatchAction,voidMatchAction,ignoreObservationAction,draftStatementAction,
 completeStatementAction,reopenStatementAction,addCashHoldAction,releaseCashHoldAction } from "./actions";

export const metadata={title:"Bank checks — Books"};
const cls="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const btn="rounded border border-border bg-card px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2";
const money=(n:number|null)=>n===null?"Unknown":formatMoney(n);
const hash=(json:unknown)=>json&&typeof json==="object"&&!Array.isArray(json)&&
 "sourceHash" in json?String(json.sourceHash):"Not completed";
export default async function BankChecksPage({searchParams}:{
 searchParams:Promise<{accountId?:string;notice?:string}>}){
 const user=await requireRole("OWNER","ADMIN"),owner=user.user.role==="OWNER";
 const params=await searchParams,accounts=await getCashAccounts(user.user.id);
 const selected=accounts.find(x=>x.id===params.accountId)??accounts[0];
 const [model,readiness,holds]=await Promise.all([
  selected?getBankMatchDesk(user.user.id,selected.id):Promise.resolve(null),
  getCashReadiness(user.user.id),
  selected?prisma.cashHold.findMany({where:{cashAccountId:selected.id},take:40,
    orderBy:{createdAt:"desc"}}):Promise.resolve([])
 ]);
 const current=readiness.banks.find(x=>x.id===selected?.id);
 const today=businessDateKey(new Date());
 const notice=params.notice?.slice(0,240);
 const first=!model?.statements.some(x=>x.status==="COMPLETED");
 return <main className="space-y-6 min-w-0">
  <header className="space-y-2">
   <Link href="/desk/books/cash" className="underline">Back to bank evidence and CSV imports</Link>
   <h1 className="text-2xl font-bold">Bank checks</h1>
   <p className="text-muted-foreground">Review real settled bank observations against source-backed Books journal lines. A match does not move money. Statements only prove a dated period; neither an import nor a match certifies today's bank balance.</p>
   {notice&&<p role="status" className="rounded border border-border p-3 break-words">{notice}</p>}
  </header>
  <section className="rounded-lg border border-border p-4 space-y-3">
   <h2 className="text-lg font-semibold">Select one bank account</h2>
   {!accounts.length?<p>No registered checking account. Register a Books bank source and import settled CSV evidence first.</p>:
    <nav aria-label="Registered bank accounts" className="flex flex-wrap gap-3">
     {accounts.map(a=><Link key={a.id} href={"/desk/books/cash/checks?accountId="+encodeURIComponent(a.id)}
       aria-current={selected?.id===a.id?"page":undefined} className="underline rounded border p-2">
       {a.name} {a.lastFour?"····"+a.lastFour:""}{selected?.id===a.id?" · Selected":""}</Link>)}
    </nav>}
  </section>
  <section className="rounded-lg border border-border p-4 space-y-3">
   <h2 className="text-lg font-semibold">Cash readiness: not authorized for funding</h2>
   <p role="status"><strong>{readiness.status}</strong> · As of {readiness.asOf} · Verified cash funding is not enabled.</p>
   <p>Conservative bank evidence before protected liabilities: {money(readiness.eligibleBankCents)}. Protected amounts: {formatMoney(readiness.protectedTotalCents)}. Provisional difference (not spendable): {money(readiness.provisionalAfterProtectedCents)}.</p>
   <p className="text-sm text-muted-foreground">{readiness.provenance}</p>
   {current&&<div className="space-y-1">
    <p>{current.name}: statement through {current.statementTo??"not confirmed"}; bank ending {money(current.endingCents)}; adjusted {money(current.eligibleCents)}.</p>
    <p>Confirmed later inflows {formatMoney(current.clearedLaterInflowsCents)}, later posted outflows {formatMoney(current.bookOutflowsCents)}, pre-statement book debits outstanding {formatMoney(current.outstandingBeforeCutoffCents)}, holds {formatMoney(current.holdsCents)}.</p>
    <p>Adjusted bank/book difference {money(current.bookDifferenceCents)}. Unresolved settled rows {current.unmatchedCount}. Statement age {current.ageDays===null?"unknown":current.ageDays+" day(s)"}.</p>
   </div>}
   <h3 className="font-semibold">Protected liabilities</h3>
   {readiness.protectedLiabilities.length===0?<p>No classified liability evidence. This does not prove zero obligations.</p>:
    <ul className="list-disc pl-5">{readiness.protectedLiabilities.map(x=><li key={x.accountId}>{x.name}: {formatMoney(x.requiredCents)}</li>)}</ul>}
   <h3 className="font-semibold">Why this cannot authorize spending</h3>
   <ul className="list-disc pl-5">{readiness.reasons.map((x,i)=><li key={i}>{x}</li>)}</ul>
  </section>
  {selected&&model&&<div className="space-y-6">
   <section className="rounded-lg border border-border p-4 space-y-3">
    <h2 className="text-lg font-semibold">Unmatched bank items and suggested Books entries</h2>
    <p>Suggestions require exact signed cents, the same bank, and the saved {model.bank.matchDays}-day Colorado window. Check the source before confirming. To record missing money, first search <Link className="underline" href="/desk/expenses">existing expenses</Link>, <Link className="underline" href="/desk/books">Books</Link> or the <Link className="underline" href="/desk/books/cash">typed cash events</Link>. Unsupported merchant, loan or payroll rows must remain unresolved.</p>
    {!model.observations.length?<p>No imported settled bank observations for this account yet.</p>:
    <div className="space-y-3">{model.observations.map(o=><article key={o.id}
     className="rounded border border-border p-3 space-y-2 break-words">
     <p><strong>{formatBusinessDate(o.postedOn)}</strong> · {formatMoney(o.signedCents)} · {o.status} · {o.description}</p>
     <p className="text-xs">Bank row ID: {o.id}</p>
     {o.ignoreReason&&<p>Ignored because: {o.ignoreReason}</p>}
     {o.status==="UNMATCHED"&&<div className="space-y-2">
      <p>Suggested matching book entries: {model.suggestions.find(s=>s.observationId===o.id)?.candidates.length??0}</p>
      <ul className="list-disc pl-5">{(model.suggestions.find(s=>s.observationId===o.id)?.candidates??[]).map(x=>
       <li key={x.id}>#{x.entryNumber} · {x.date} · {formatMoney(x.amountCents)} · {x.source} · {x.id}</li>)}</ul>
      {owner&&<form action={ignoreObservationAction} className="grid gap-2 sm:grid-cols-2">
       <input type="hidden" name="accountId" value={selected.id}/>
       <input type="hidden" name="observationId" value={o.id}/>
       <input type="hidden" name="version" value={o.version}/>
       <label>Reason type<select name="classification" className={cls}>
        <option value="DUPLICATE">Verified duplicate</option><option value="NON_ACCOUNT">Not our bank account</option>
       </select></label>
       <label>Evidence explanation<input name="reason" className={cls} maxLength={250} required/></label>
       <button className={btn}>Ignore this verified duplicate/non-account row</button>
      </form>}
     </div>}
    </article>)}</div>}
    <h3 className="font-semibold">Confirm a match group</h3>
    <p>Choose one or more bank rows and one or more book lines, all with the same debit/credit direction and matching signed totals. No automatic match or new accounting entry.</p>
    <form action={confirmMatchAction} className="grid gap-3 sm:grid-cols-2">
     <input type="hidden" name="accountId" value={selected.id}/>
     <input type="hidden" name="commandKey" value={randomUUID()}/>
     <fieldset className="border border-border rounded p-3 space-y-2">
      <legend className="font-semibold">Bank rows</legend>
      {model.observations.filter(o=>o.status==="UNMATCHED").map(o=>
       <label key={o.id} className="flex gap-2 items-start">
        <input type="checkbox" name="observationIds" value={o.id}/>
        <span>{formatBusinessDate(o.postedOn)} · {formatMoney(o.signedCents)} · {o.description}</span>
        <input type="hidden" name="observationVersions" value={o.id+":"+o.version}/>
       </label>)}
     </fieldset>
     <fieldset className="border border-border rounded p-3 space-y-2">
      <legend className="font-semibold">Unclaimed Books bank lines</legend>
      {model.lines.map(l=><label key={l.id} className="flex gap-2 items-start">
       <input type="checkbox" name="journalLineIds" value={l.id}/>
       <span>#{l.entry.entryNumber} · {formatBusinessDate(l.entry.entryDate)} · {formatMoney(l.debitCents-l.creditCents)} · {l.entry.sourceType}</span>
      </label>)}
     </fieldset>
     <button className={btn}>Confirm exact bank/book group</button>
    </form>
    <h3 className="font-semibold">Previous match decisions</h3>
    {model.groups.map(g=><article key={g.id} className="border-t border-border pt-2 space-y-1">
     <p>{g.id} · {g.voidedAt?"Voided":"Active"} · {g.items.filter(x=>x.active&&x.bankObservationId).length} bank rows / {g.items.filter(x=>x.active&&x.journalLineId).length} journal lines</p>
     {g.voidedReason&&<p>{g.voidedReason}</p>}
     {!g.voidedAt&&<form action={voidMatchAction} className="flex flex-wrap gap-2 items-end">
      <input type="hidden" name="accountId" value={selected.id}/><input type="hidden" name="groupId" value={g.id}/>
      <input type="hidden" name="version" value={g.version}/>
      <label className="flex-1">Why this match is wrong<input name="reason" maxLength={300} className={cls} required/></label>
      <button className={btn}>Void match with history</button>
     </form>}
    </article>)}
   </section>
   <section className="rounded-lg border border-border p-4 space-y-3">
    <h2 className="text-lg font-semibold">Statement reconciliation</h2>
    <p>Owner confirms a real statement balance independently. Complete only if every row is matched or a justified duplicate/non-account row, the bank equation is exactly zero cents and bank matches independently equal book lines. Later periods must be contiguous. Completed evidence is immutable.</p>
    {owner&&<form action={draftStatementAction} className="grid gap-3 sm:grid-cols-2">
     <input type="hidden" name="accountId" value={selected.id}/>
     <label>Statement starts<input type="date" name="fromDate" max={today} className={cls} required/></label>
     <label>Statement ends<input type="date" name="toDate" max={today} className={cls} required/></label>
     <label>Beginning balance ($)<input name="beginning" className={cls} inputMode="decimal" required/></label>
     <label>Ending balance ($)<input name="ending" className={cls} inputMode="decimal" required/></label>
     {first&&<div className="sm:col-span-2 space-y-3">
      <h3 className="font-semibold">First statement: verified Books opening composition</h3>
      <p>Use actual bank/book records only. The Books balance plus explicit outstanding prior entries must equal the statement beginning balance.</p>
      <label className="block">Books balance just before start ($)<input name="bookBeginning" className={cls} inputMode="decimal" required/></label>
      <label className="block">Pre-start bank items not yet in Books ($, signed)<input name="outstanding" className={cls} inputMode="decimal" required/></label>
      <label className="block">Independent bank/opening source reference<input name="sourceReference" className={cls} maxLength={250} required/></label>
     </div>}
     <button className={btn}>Create unverified statement draft</button>
    </form>}
    <h3 className="font-semibold">Statement history</h3>
    {!model.statements.length?<p>No statement has been drafted or completed.</p>:
    model.statements.map(s=><article key={s.id} className="rounded border border-border p-3 space-y-2">
     <p><strong>{formatBusinessDate(s.fromOn)} to {formatBusinessDate(s.toOn)}</strong> · {s.status} · revision {s.revisionNo} {s.isCurrent?"· Current":"· Historical"}</p>
     <p>Beginning {formatMoney(s.beginningCents)}; ending {formatMoney(s.endingCents)}; evidence hash {hash(s.includedEvidence)}</p>
     {s.priorCompletedId&&<p>Prior immutable proof: {s.priorCompletedId}</p>}
     {s.reopenReason&&<p>Reopened because: {s.reopenReason}</p>}
     {owner&&s.isCurrent&&["DRAFT","REOPENED"].includes(s.status)&&<form action={completeStatementAction}>
      <input type="hidden" name="accountId" value={selected.id}/>
      <input type="hidden" name="statementId" value={s.id}/><input type="hidden" name="version" value={s.version}/>
      <button className={btn}>Verify and complete zero-difference statement</button>
     </form>}
     {owner&&s.isCurrent&&s.status==="COMPLETED"&&<form action={reopenStatementAction} className="flex gap-2 flex-wrap items-end">
      <input type="hidden" name="accountId" value={selected.id}/>
      <input type="hidden" name="statementId" value={s.id}/><input type="hidden" name="version" value={s.version}/>
      <label className="flex-1">Reason to reopen<input name="reason" maxLength={300} className={cls} required/></label>
      <button className={btn}>Reopen with immutable history</button>
     </form>}
    </article>)}
   </section>
   {owner&&<section className="rounded-lg border border-border p-4 space-y-3">
    <h2 className="text-lg font-semibold">Cash holds — reduce eligible evidence, never move bank funds</h2>
    <form action={addCashHoldAction} className="grid gap-2 sm:grid-cols-2">
     <input type="hidden" name="accountId" value={selected.id}/>
     <label>Amount held ($)<input name="amount" className={cls} inputMode="decimal" required/></label>
     <label>Effective day<input name="effectiveDate" type="date" max={today} defaultValue={today} className={cls} required/></label>
     <label className="sm:col-span-2">Why money is at risk (not a posted bank debit)<input name="reason" minLength={12} maxLength={300} className={cls} required/></label>
     <button className={btn}>Record conservative hold</button>
    </form>
    {holds.map(h=><article key={h.id} className="border-t border-border pt-2 space-y-2">
     <p>{formatMoney(h.amountCents)} · {h.releasedAt?"Released":"Active"} · {h.reason}</p>
     {!h.releasedAt&&<form action={releaseCashHoldAction} className="flex flex-wrap gap-2 items-end">
      <input type="hidden" name="accountId" value={selected.id}/>
      <input type="hidden" name="holdId" value={h.id}/><input type="hidden" name="version" value={h.version}/>
      <label className="flex-1">Verified release reason<input name="reason" minLength={12} maxLength={300} className={cls} required/></label>
      <button className={btn}>Release hold with audit</button>
     </form>}
    </article>)}
   </section>}
  </div>}
 </main>;
}
