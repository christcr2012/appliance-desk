import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/session";
import { getShownFeatures } from "@/domains/features";
import { isHrefHidden } from "@/domains/features/registry";
import { prisma } from "@/lib/prisma";
import { getCashDesk } from "@/domains/books/cash/desk";
import { businessDateKey, formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { registerCashAccountAction,setCashMatchWindowAction,createCashEventAction,
 voidCashEventAction,attachBankStatementAction } from "./actions";
import { BankCsvImporter } from "./bank-csv-importer";
import { BankStatementUpload } from "./bank-statement-upload";

export const metadata={title:"Bank statements and cash records — Books"};
const input="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const button="rounded border border-border bg-card px-3 py-2 text-foreground font-semibold focus-visible:outline-2 focus-visible:outline-offset-2";
const EVENT_NAMES:Record<string,string>={
 OWNER_CONTRIBUTION:"Owner contribution",OWNER_DRAW:"Owner draw",BANK_TRANSFER:"Bank to bank transfer",
 BANK_INTEREST:"Bank interest earned",CARD_PAYMENT:"Card payment",CASH_DEPOSIT:"Deposit linked cash/check receipts",
};
export default async function CashEvidencePage({searchParams}:{searchParams:Promise<{notice?:string}>}){
 const session=await requireRole("OWNER","ADMIN","ACCOUNTANT"),owner=session.user.role==="OWNER";
 const [data,settings]=await Promise.all([getCashDesk(session.user.id),
  prisma.businessSettings.findUnique({where:{id:"singleton"},select:{booksStartDate:true}})]);
 const notice=(await searchParams).notice?.slice(0,300),today=businessDateKey(new Date());
 const shown=await getShownFeatures();
 return <div className="space-y-6">
  <header className="space-y-2">
   <nav aria-label="Books bank workspaces" className="flex flex-wrap gap-2">
    <Link href="/desk/books" className="underline rounded px-2 py-2">Back to Books</Link>
    {!isHrefHidden("/desk/books/cash/checks", shown) && <Link href="/desk/books/cash/checks" className="underline rounded px-2 py-2">Bank checks and statement reconciliation</Link>}
    {!isHrefHidden("/desk/books/budget", shown) && <Link href="/desk/books/budget" className="underline rounded px-2 py-2">Budget backing</Link>}
   </nav>
   <h1 className="text-2xl font-bold">Bank statements and cash records</h1>
   <p className="text-muted-foreground">Import settled bank evidence and review it in Bank checks. Nothing here initiates bank transfers, verifies live balances automatically, or funds a budget.</p>
   {notice&&<p role="status" className="rounded border border-border p-3">{notice}</p>}
   {!settings?.booksStartDate&&<p role="alert">Initialize owner-approved Books opening balances before any typed cash event can be journaled.</p>}
  </header>
  {owner&&<section className="rounded-lg border border-border p-4 space-y-3">
   <h2 className="text-lg font-semibold">Register your business bank source</h2>
   <p>Use an existing business payment-source account. Do not enter full bank/routing numbers or credentials.</p>
   {data.availableBanks.length?<form action={registerCashAccountAction} className="grid gap-3 sm:grid-cols-2">
    <label>Books account<select name="ledgerAccountId" className={input} required>
     {data.availableBanks.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
    </select></label>
    <label>Bank display name<input name="name" className={input} maxLength={120} required/></label>
    <label>Institution label<input name="institutionLabel" className={input} maxLength={120} required/></label>
    <label>Last four digits (optional)<input name="lastFour" className={input} maxLength={4} pattern="[0-9]{4}"/></label>
    <button className={button}>Register evidence source</button>
   </form>:<p>No unmapped business BANK asset source is available. Configure a Books account first.</p>}
  </section>}
  <section className="space-y-3">
   <h2 className="text-lg font-semibold">Registered evidence sources</h2>
   {data.registered.length===0?<p>No business bank has been registered for observation import.</p>:
    data.registered.map(a=><article className="rounded-lg border border-border p-4 space-y-2" key={a.id}>
     <h3 className="font-semibold">{a.name} · {a.institutionLabel}{a.lastFour?" ····"+a.lastFour:""}</h3>
     <p className="text-sm text-muted-foreground">Ledger: {a.ledgerAccount.name} · Match window {a.bankMatchWindowDays} day(s) · Importing does not confirm balance or reconciliation</p>
     {owner&&<form action={setCashMatchWindowAction} className="flex gap-2 flex-wrap items-end">
      <input type="hidden" name="cashAccountId" value={a.id}/><input type="hidden" name="version" value={a.version}/>
      <label>Match window, 0–30 days<input className={input} type="number" name="days" min={0} max={30} defaultValue={a.bankMatchWindowDays} required/></label>
      <button className={button}>Save match window</button>
     </form>}
     {a.imports.length>0&&<div className="space-y-2">
      <h4 className="font-semibold">Imported statement evidence</h4>
      {a.imports.map(file=><div key={file.id} className="border-t border-border pt-2 space-y-1">
       <p>{file.status} · {file.rowCount} source rows · {formatBusinessDate(file.createdAt)}</p>
       <p className="text-xs text-muted-foreground break-all">Source SHA-256: {file.sha256}</p>
       {file.privateEvidenceId?<Link href={`/api/photos/${encodeURIComponent(file.privateEvidenceId)}`} className="underline">Read attached private statement</Link>:
        <BankStatementUpload importId={file.id} accountId={a.id} onAttach={attachBankStatementAction}/>}
      </div>)}
     </div>}
    </article>)}
  </section>
  <BankCsvImporter accounts={data.registered.map(a=>({id:a.id,name:a.name,lastFour:a.lastFour}))} owner={owner}/>
  <section className="rounded-lg border border-border p-4 space-y-3">
   <h2 className="text-lg font-semibold">Cash records</h2>
   <p className="text-sm text-muted-foreground">Journal posted only from verified source types, never manual free-form entries. An owner contribution, bank transfer or draw here records accounting evidence; it does not actually move funds. Bank sources and money movements must be independently verified.</p>
   {owner&&<form action={createCashEventAction} className="grid gap-3 sm:grid-cols-2">
    <input type="hidden" name="commandKey" value={randomUUID()}/>
    <label>Event type<select className={input} name="kind">{Object.entries(EVENT_NAMES).map(([kind,label])=><option value={kind} key={kind}>{label}</option>)}</select></label>
    <label>Amount in dollars<input name="amount" className={input} inputMode="decimal" placeholder="0.00" required/></label>
    <label>Recorded bank movement date<input type="date" name="occurredDate" className={input} max={today} defaultValue={today} required/></label>
    <label>From registered business account (if applicable)<select className={input} name="fromLedgerAccountId"><option value="">Not applicable</option>
     {data.registered.map(a=><option key={a.id} value={a.ledgerAccountId}>{a.name}</option>)}</select></label>
    <label>To registered business account (if applicable)<select className={input} name="toLedgerAccountId"><option value="">Not applicable</option>
     {data.registered.map(a=><option key={a.id} value={a.ledgerAccountId}>{a.name}</option>)}</select></label>
    <label>Source receipt IDs, comma-separated (cash/check deposits only)<input className={input} name="receiptIds" placeholder="Only confirmed cash/check receipts"/></label>
    <label className="sm:col-span-2">Reason / evidence description<input className={input} name="memo" maxLength={300} required/></label>
    <button className={button}>Record balanced cash event</button>
   </form>}
   {data.events.length>0&&<div className="space-y-3">
    <h3 className="font-semibold">Recent source-backed events</h3>
    {data.events.map(e=><article key={e.id} className="rounded border border-border p-3 space-y-1">
     <p><strong>{EVENT_NAMES[e.kind]??e.kind}</strong> · {formatMoney(e.amountCents)} · {e.status} · {formatBusinessDate(e.occurredOn)}</p>
     <p className="break-words text-sm">{e.memo}</p>
     {e.reversalOfId&&<p className="text-sm">Reversal of {e.reversalOfId}</p>}
     {owner&&e.status==="POSTED"&&!e.reversalOfId&&<form action={voidCashEventAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={e.id}/><input type="hidden" name="version" value={e.version}/>
      <input type="hidden" name="commandKey" value={randomUUID()}/>
      <label className="min-w-0 flex-1">Reason to reverse<input className={input} name="reason" maxLength={250} required/></label>
      <button className={button}>Reverse with immutable journal</button>
     </form>}
    </article>)}
   </div>}
  </section>
 </div>;
}
