import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getBooksWorkspace } from "@/domains/books/management";
import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import {
  initializeBooksAction, renameAccountAction, createAccountAction, mapExportAccountAction,
  postBooksAction, closeMonthAction, reopenMonthAction,
} from "./actions";

export const metadata={title:"Books — Accounting"};
const input="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const button="rounded border border-border bg-card px-3 py-2 text-foreground font-medium hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2";
export default async function BooksPage({searchParams}:{searchParams:Promise<{month?:string;page?:string;notice?:string}>}) {
  const session=await requireRole("OWNER","ADMIN");
  const params=await searchParams;
  const owner=session.user.role==="OWNER";
  const model=await getBooksWorkspace({id:session.user.id,role:session.user.role},{
    month:params.month,page:Number(params.page)||1,
  });
  const selected=params.month??new Date().toISOString().slice(0,7);
  const notice=params.notice?.slice(0,200);
  return <div className="space-y-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-bold">Books and journal</h1>
      <p className="text-muted-foreground">Account balances and source-backed double-entry records. No payment is sent from this screen.</p>
      {notice&&<p role="status" className="rounded border border-border p-3">{notice}</p>}
    </header>
    {!model.settings?.booksStartDate ? <section className="rounded-lg border border-border p-4 space-y-3">
      <h2 className="text-lg font-semibold">Start your books</h2>
      <p>Choose the first day you want recorded. Enter balances you have independently checked with your bank and Stripe; nothing is guessed. This starting entry cannot be reset once saved.</p>
      {owner?<form action={initializeBooksAction} className="grid gap-3 sm:grid-cols-2">
        <label>Start date<input type="date" name="startDate" required className={input}/></label>
        <label>Stripe opening balance ($)<input type="text" inputMode="decimal" name="stripe" defaultValue="0.00" required className={input}/></label>
        <label>Checking account ($)<input type="text" inputMode="decimal" name="bank" defaultValue="0.00" required className={input}/></label>
        <label>Credit card owed ($)<input type="text" inputMode="decimal" name="card" defaultValue="0.00" required className={input}/></label>
        <button className={button} type="submit">Confirm and start books</button>
      </form>:<p>The owner must choose and attest the starting balances.</p>}
    </section>:<section className="rounded-lg border border-border p-4 space-y-3">
      <h2 className="text-lg font-semibold">Journal</h2>
      <p>Started {formatBusinessDate(model.settings.booksStartDate)}. Journal entries are immutable; corrections require a separately recorded reversing entry.</p>
      <form action={postBooksAction}><button type="submit" className={button}>Bring the books up to date</button></form>
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <label>Month <input className={input} type="month" name="month" defaultValue={selected}/></label>
        <button type="submit" className={button}>View this month</button>
        <Link className="underline" href="/desk/books">All entries</Link>
        <a className="underline" href={"/desk/books/export?month="+encodeURIComponent(selected)}>Download reviewed journal CSV</a>
      </form>
      <div className="overflow-x-auto"><table className="min-w-full text-sm">
        <caption className="text-left text-muted-foreground pb-2">{model.total} journal entries; showing at most 30 per page</caption>
        <thead><tr className="border-b border-border text-left"><th scope="col">Date / entry</th><th scope="col">Original source</th><th scope="col">Accounts, debits and credits</th></tr></thead>
        <tbody>{model.entries.map(entry=><tr className="border-b border-border align-top" key={entry.id}>
          <td className="p-2 whitespace-nowrap">{formatBusinessDate(entry.entryDate)}<p>#{entry.entryNumber}</p>{entry.lateForDate&&<p>Late for {formatBusinessDate(entry.lateForDate)}</p>}</td>
          <td className="p-2 break-all">{entry.sourceType}<p>{entry.sourceId}</p><p>{entry.eventKind}</p></td>
          <td className="p-2"><p className="font-medium">{entry.memo}</p>{entry.lines.map(line=><p key={line.id} className="flex gap-3 justify-between">
            <span>{line.ledgerAccount.name}</span><span className="tabular-nums">{line.debitCents?formatMoney(line.debitCents)+" debit":formatMoney(line.creditCents)+" credit"}</span></p>)}</td>
        </tr>)}</tbody>
      </table></div>
      <nav aria-label="Journal pages" className="flex gap-4">
        {model.page>1&&<Link className="underline" href={`/desk/books?month=${model.month??""}&page=${model.page-1}`}>Previous</Link>}
        {model.page*30<model.total&&<Link className="underline" href={`/desk/books?month=${model.month??""}&page=${model.page+1}`}>Next</Link>}
      </nav>
      <p className="text-sm text-muted-foreground">Recorded month statuses: {model.periods.length?model.periods.map(p=>p.periodKey+" "+p.status).join(" · "):"All months currently open"}</p>
      {owner&&<div className="grid gap-4 sm:grid-cols-2">
        <form action={closeMonthAction} className="space-y-2 rounded border border-border p-3">
          <h3 className="font-semibold">Close reviewed month</h3>
          <p>Export the journal before closing. New late entries move to the next open month.</p>
          <input type="hidden" name="month" value={selected}/><button className={button} type="submit">Close {selected}</button>
        </form>
        <form action={reopenMonthAction} className="space-y-2 rounded border border-border p-3">
          <h3 className="font-semibold">Reopen with audit reason</h3>
          <input type="hidden" name="month" value={selected}/>
          <label>Why is this month reopening?<input className={input} name="reason" required maxLength={300}/></label>
          <button className={button} type="submit">Reopen {selected}</button>
        </form>
      </div>}
    </section>}
    {model.issues.length>0&&<section className="rounded-lg border border-border p-4 space-y-2">
      <h2 className="text-lg font-semibold">Accounting items needing review</h2>
      <p>These sources were not fully recorded; inspect the underlying billing or expense record before trying again.</p>
      <ul className="space-y-2">{model.issues.map(issue=><li key={issue.id} className="border-t border-border py-2">
        <p className="font-semibold">{issue.summary}</p><p className="text-sm">{issue.detail}</p>
        <p className="text-xs text-muted-foreground">Detected {issue.occurrences} time(s).</p>
      </li>)}</ul>
    </section>}
    <section className="rounded-lg border border-border p-4 space-y-3">
      <h2 className="text-lg font-semibold">Chart of accounts</h2>
      <p className="text-sm text-muted-foreground">System account types and roles are fixed. Owner-renamed labels and export mappings keep the underlying journal history.</p>
      <div className="space-y-2">{model.accounts.map(a=><div className="grid gap-2 border-t border-border py-3 sm:grid-cols-3" key={a.id}>
        <div><p className="font-semibold">{a.name}</p><p className="text-xs text-muted-foreground">{a.type} · {a.description}</p><p className="font-medium">Net book movement: {formatMoney((model.balances.find(row=>row.ledgerAccountId===a.id)?._sum.debitCents??0)-(model.balances.find(row=>row.ledgerAccountId===a.id)?._sum.creditCents??0))}</p></div>
        {owner?<form action={renameAccountAction} className="flex gap-2 items-end">
          <input type="hidden" name="accountId" value={a.id}/><label className="flex-1">Account name<input className={input} name="name" defaultValue={a.name} maxLength={120}/></label><button className={button}>Save</button>
        </form>:<p>{a.name}</p>}
        {owner?<form action={mapExportAccountAction} className="flex flex-wrap gap-2 items-end">
          <input type="hidden" name="accountId" value={a.id}/>
          <label>Export to<select name="target" className={input}><option value="GENERIC_JOURNAL_CSV">Generic CSV</option><option value="QBO_JOURNAL_CSV">QuickBooks</option><option value="XERO_JOURNAL_CSV">Xero</option></select></label>
          <label className="flex-1">External account<input name="externalName" className={input} placeholder="Account name or code" required/></label>
          <button className={button}>Map</button>
        </form>:<p>{a.mappings.length} saved export mappings</p>}
      </div>)}</div>
      {owner&&<form action={createAccountAction} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
        <h3 className="col-span-full font-semibold">Add an account</h3>
        <label>Name<input className={input} name="name" required/></label><label>Description<input className={input} name="description" required/></label>
        <label>Type<select className={input} name="type"><option value="ASSET">Asset</option><option value="LIABILITY">Liability</option><option value="EXPENSE">Expense</option></select></label>
        <label className="flex gap-2 items-center"><input type="checkbox" name="isPaymentSource"/> Can pay expenses from this account</label>
        <button type="submit" className={button}>Add account</button>
      </form>}
    </section>
  </div>;
}
