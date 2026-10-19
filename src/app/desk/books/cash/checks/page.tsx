import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/session";
import { getCashAccounts } from "@/domains/books/cash/accounts";
import { getBankMatchCandidates } from "@/domains/books/cash/matching";
import { getBankReconciliationHistory } from "@/domains/books/cash/reconciliation";
import { readBankCashReadiness } from "@/domains/books/cash/readiness";
import { prisma } from "@/lib/prisma";
import { businessDateKey,formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import {
 confirmBankMatchAction,voidBankMatchAction,ignoreBankRowAction,
 completeBankStatementAction,reopenBankStatementAction,
} from "./actions";

export const metadata={title:"Bank matching and statement reconciliation — Books"};
const field="w-full min-w-0 rounded border border-border bg-background px-3 py-2 text-foreground";
const button="rounded border border-border bg-card px-3 py-2 text-foreground font-medium focus-visible:outline-2 focus-visible:outline-offset-2";
export default async function CashChecksPage({searchParams}:{
 searchParams:Promise<{accountId?:string;notice?:string}>
}){
 const session=await requireRole("OWNER","ADMIN"),owner=session.user.role==="OWNER";
 const params=await searchParams;
 const accounts=await getCashAccounts(session.user.id);
 const account=accounts.find(x=>x.id===params.accountId)??accounts[0];
 const cash=await readBankCashReadiness(session.user.id);
 const selected=cash.accounts.find(x=>x.id===account?.id);
 const today=businessDateKey(new Date());
 const [candidates,history,groups]=account?await Promise.all([
  getBankMatchCandidates(session.user.id,account.id),
  getBankReconciliationHistory(session.user.id,account.id),
  prisma.bankMatchGroup.findMany({where:{cashAccountId:account.id,voidedAt:null},
    orderBy:{createdAt:"desc"},take:40,
    select:{id:true,version:true,key:true,createdAt:true,items:{select:{
      bankObservationId:true,journalLineId:true,signedCents:true,
    }}}},
  }),
 ]:[null,[],[]];
 const current=history.find(x=>x.status==="COMPLETED"&&x.isCurrent);
 const last=current?.toOn?businessDateKey(current.toOn):null;
 const suggestedStart=last?new Date(Date.parse(last+"T00:00:00Z")+86400000).toISOString().slice(0,10):today.slice(0,7)+"-01";
 return <div className="space-y-6">
  <header className="space-y-2">
   <Link href="/desk/books/cash" className="underline">Back to bank evidence and source journals</Link>
   <h1 className="text-2xl font-bold">Bank matching and statement checks</h1>
   <p>Match settled observations to existing cash journal evidence before checking an actual bank statement. Matching never posts accounting or moves money. A statement is proof for its historical date, not live spendable cash.</p>
   {params.notice&&<p role="status" className="rounded border border-border p-3 break-words">{params.notice.slice(0,450)}</p>}
  </header>
  {!account?<p>No verified bank source is registered. <Link href="/desk/books/cash" className="underline">Register an existing Books bank account first.</Link></p>:
  <>
   <nav aria-label="Business bank source" className="flex flex-wrap gap-2">
    {accounts.map(a=><Link key={a.id} className="underline rounded border border-border px-3 py-2"
      href={`/desk/books/cash/checks?accountId=${encodeURIComponent(a.id)}`}>{a.name}</Link>)}
   </nav>
   <section className="rounded border border-border p-4 space-y-2">
    <h2 className="font-semibold text-lg">Verified cash evidence — {account.name}</h2>
    <p className="font-medium">{selected?.status??"UNKNOWN"} · {selected?.cutoff?"Last completed "+selected.cutoff:"No completed statement"}</p>
    {selected?.components&&<p className="tabular-nums">Provisional bank cash: {formatMoney(selected.components.provisionalCents)} · ending {formatMoney(selected.components.endingCents)} · later booked outflows {formatMoney(selected.components.laterBookedOutflowsCents)} · outstanding earlier outflows {formatMoney(selected.components.priorOutstandingOutflowsCents)} · unreleased holds {formatMoney(selected.components.unreleasedHoldsCents)}</p>}
    <p>Assignable amount: <strong>$0.00</strong>. Positive budget funding stays disabled until the separate protected-obligations workflow is completed.</p>
    <ul className="list-disc pl-5">{selected?.reasons.map(x=><li key={x}>{x}</li>)}</ul>
   </section>
   <section className="rounded border border-border p-4 space-y-3">
    <h2 className="text-lg font-semibold">Review and match bank observations</h2>
    <p>Bank day window: {account.bankMatchWindowDays} days. Suggestions are informational; confirm an exact signed one-to-one or many-to-many set with the same registered bank account. No opposite-sign netting.</p>
    <form action={confirmBankMatchAction} className="space-y-3">
     <input type="hidden" name="accountId" value={account.id}/>
     <input type="hidden" name="key" value={randomUUID()}/>
     <div className="grid gap-3 lg:grid-cols-2">
      <fieldset className="min-w-0 rounded border border-border p-3">
       <legend className="font-semibold">Unmatched settled observations</legend>
       <div className="space-y-2">{candidates?.observations.length?candidates.observations.map(o=><label key={o.id} className="flex gap-2 border-b border-border p-2 items-start">
        <input type="checkbox" className="mt-1" name="observations" value={o.id}/>
        <span className="min-w-0 break-words">{formatBusinessDate(o.postedOn)} · {formatMoney(o.signedCents)} · {o.description}
         {o.suggestions.length>0&&<span className="block text-xs text-muted-foreground">Suggested source lines: {o.suggestions.length}</span>}</span>
       </label>):<p>No unmatched observations in the first 80 records.</p>}</div>
      </fieldset>
      <fieldset className="min-w-0 rounded border border-border p-3">
       <legend className="font-semibold">Unclaimed posted bank journal lines</legend>
       <div className="space-y-2">{candidates?.lines.map(l=><label key={l.id} className="flex gap-2 border-b border-border p-2 items-start">
        <input name="journalLines" value={l.id} type="checkbox" className="mt-1"/>
        <span className="min-w-0 break-words">{formatBusinessDate(l.entry.entryDate)} · {formatMoney(l.debitCents-l.creditCents)} · journal #{l.entry.entryNumber} · {l.entry.sourceType} {l.entry.eventKind}</span>
       </label>)}</div>
      </fieldset>
     </div>
     <button className={button}>Confirm exact signed bank match</button>
    </form>
    {owner&&candidates?.observations.length? <details className="rounded border border-border p-3">
     <summary className="cursor-pointer">Review a true duplicate or non-account import row</summary>
     <p>Do not ignore an unknown expense, deposit, fee, payment, loan or payroll movement. Use an existing <Link href="/desk/expenses" className="underline">expense</Link>, <Link href="/desk/books/cash" className="underline">typed cash source</Link>, or verified customer receipt instead.</p>
     {candidates.observations.map(o=><form key={o.id} action={ignoreBankRowAction} className="flex flex-wrap gap-2 py-2 border-b border-border items-end">
      <input type="hidden" name="accountId" value={account.id}/>
      <input type="hidden" name="id" value={o.id}/><input type="hidden" name="version" value={o.version}/>
      <span className="break-words min-w-36">{formatBusinessDate(o.postedOn)} · {formatMoney(o.signedCents)}</span>
      <label className="min-w-40">Evidence type<select name="kind" className={field}>
       <option value="NON_ACCOUNT_ROW">Proven non-account row</option><option value="DUPLICATE">Proven duplicate</option>
      </select></label>
      <label className="flex-1 min-w-40">Independent evidence/reason<input className={field} name="reason" maxLength={300} required/></label>
      <button className={button}>Ignore reviewed non-ledger row</button>
     </form>)}
    </details>:null}
    {groups.length>0&&<div className="space-y-2">
     <h3 className="font-semibold">Active match groups</h3>
     {groups.map(g=><article key={g.id} className="border-t border-border py-2 space-y-1">
      <p>{formatBusinessDate(g.createdAt)} · {g.items.filter(x=>x.bankObservationId).length} bank row(s), {g.items.filter(x=>x.journalLineId).length} source line(s)</p>
      <form action={voidBankMatchAction} className="flex gap-2 flex-wrap items-end">
       <input type="hidden" name="accountId" value={account.id}/><input type="hidden" name="id" value={g.id}/><input type="hidden" name="version" value={g.version}/>
       <label className="min-w-36 flex-1">Reason to undo match<input className={field} name="reason" maxLength={300} required/></label>
       <button className={button}>Void match (preserve history)</button>
      </form>
     </article>)}
    </div>}
   </section>
   <section className="rounded border border-border p-4 space-y-3">
    <h2 className="text-lg font-semibold">Statement reconciliation</h2>
    <p>A real statement range must be consecutive. Reconciliation requires confirmed beginning book cash, all outstanding earlier source IDs, every imported observation matched or specifically justified, and an exact zero-cent ending difference. No balancing adjustment is generated.</p>
    {owner&&<form action={completeBankStatementAction} className="grid gap-3 sm:grid-cols-2">
     <input type="hidden" name="accountId" value={account.id}/>
     <input type="hidden" name="accountVersion" value={account.version}/>
     <label>Statement from (Colorado)<input className={field} name="from" type="date" defaultValue={suggestedStart} required/></label>
     <label>Statement through<input className={field} name="through" type="date" max={today} defaultValue={today} required/></label>
     <label>Beginning bank balance ($; signed)<input className={field} name="beginning" inputMode="decimal" placeholder="0.00" required/></label>
     <label>Ending bank balance ($; signed)<input className={field} name="ending" inputMode="decimal" placeholder="0.00" required/></label>
     <label>Complete settled bank activity through<input className={field} name="completeThrough" type="date" max={today} defaultValue={today} required/></label>
     <label>Statement/private evidence reference<input className={field} name="sourceReference" required maxLength={260}/></label>
     <fieldset className="sm:col-span-2 min-w-0 rounded border border-border p-3">
      <legend className="font-semibold">Opening statement source acknowledgment</legend>
      <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" name="openingConfirmed"/>
       <span>I confirm the beginning bank balance and every outstanding prior book bank line. The bank statement is not an automatically inferred opening journal.</span>
      </label>
      <p className="text-sm">Select every source bank line outstanding before your first statement start (not just this period). All pre-start unclaimed lines must be acknowledged.</p>
      {candidates?.lines.map(l=><label key={l.id} className="flex gap-2 border-t border-border p-2">
       <input type="checkbox" name="openingOutstanding" value={l.id}/>
       <span className="break-words">{formatBusinessDate(l.entry.entryDate)} · {formatMoney(l.debitCents-l.creditCents)} · #{l.entry.entryNumber}</span>
      </label>)}
     </fieldset>
     <button className={button}>Complete exact statement proof</button>
    </form>}
    <h3 className="font-semibold">Statement history and revisions</h3>
    {history.length===0?<p>No confirmed statement evidence yet.</p>:history.map(x=><article key={x.id} className="border-t border-border py-2 space-y-2">
     <p>{formatBusinessDate(x.fromOn)} – {formatBusinessDate(x.toOn)} · {x.status} {x.isCurrent?"· current":""} · revision {x.revisionNo} · beginning {formatMoney(x.beginningCents)} / ending {formatMoney(x.endingCents)}</p>
     <p className="text-xs break-all">Evidence SHA-256: {typeof x.includedEvidence==="object"&&x.includedEvidence&&!Array.isArray(x.includedEvidence)?"sha256" in x.includedEvidence?String(x.includedEvidence.sha256):"missing":"not verified"}</p>
     {x.reopenReason&&<p>Previous review: {x.reopenReason}</p>}
     {owner&&x.isCurrent&&x.status==="COMPLETED"&&<form action={reopenBankStatementAction} className="flex flex-wrap gap-2 items-end">
      <input type="hidden" name="accountId" value={account.id}/><input type="hidden" name="id" value={x.id}/>
      <input type="hidden" name="version" value={x.version}/>
      <label className="min-w-40 flex-1">Correction reason<input name="reason" className={field} maxLength={300} required/></label>
      <button className={button}>Reopen and invalidate later verification</button>
     </form>}
    </article>)}
   </section>
  </>}
 </div>;
}
