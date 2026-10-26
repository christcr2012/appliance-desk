import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getBooksWorkspace, currentOpeningBalances } from "@/domains/books/management";
import { OpeningCorrectionSheet } from "./opening-correction-sheet";
import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import {
  renameAccountAction, createAccountAction, mapExportAccountAction,
  postBooksAction, closeMonthAction, reopenMonthAction,
} from "./actions";

export const metadata={title:"Your books"};
const input="min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const button="rounded border border-border bg-card px-3 py-2 text-foreground font-medium hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2";
const SOURCE_LABEL: Record<string, string> = {
  INVOICE: "A bill to a customer", PAYMENT: "A customer payment", REFUND: "A refund", EXPENSE: "A business expense",
  CUSTOMER_CREDIT: "Credit on a customer's account", APPLIANCE: "An appliance you own", USE_TAX: "Use tax you owe",
  TAX_FILING: "A tax filing", OPENING: "Your starting balances", HELD_PAYMENT: "A payment held for review",
  STRIPE_BALANCE_TXN: "A Stripe card transaction", RECURRING_EXPENSE: "A repeating expense",
};
const sourceLabel = (type: string) => SOURCE_LABEL[type.toUpperCase()] ?? type.replace(/_/g, " ").toLowerCase();
export default async function BooksPage({searchParams}:{searchParams:Promise<{month?:string;page?:string;notice?:string}>}) {
  const session=await requireRole("OWNER","ADMIN");
  const params=await searchParams;
  const owner=session.user.role==="OWNER";
  const model=await getBooksWorkspace({id:session.user.id,role:session.user.role},{
    month:params.month,page:Number(params.page)||1,
  });
  const selected=params.month??new Date().toISOString().slice(0,7);
  const opening=owner&&model.settings?.booksStartDate
    ? await currentOpeningBalances({id:session.user.id,role:"OWNER"}):null;
  const notice=params.notice?.slice(0,200);
  return <div className="space-y-6">
    <header className="space-y-2">
      <nav aria-label="More about your books" className="flex flex-wrap gap-x-5 gap-y-2">
      <Link className="underline" href="/desk/expenses">Expenses and receipts</Link>
      <Link className="underline" href="/desk/books/exports">Export to QuickBooks, Xero or CSV</Link>
      <Link className="underline" href="/desk/books/assets">Rental equipment and book depreciation</Link>
      <Link className="underline" href="/desk/books/reports">Profit, balance and payback</Link>
      <Link className="underline" href="/desk/books/cash">Bank statements and cash records</Link>
      <Link className="underline" href="/desk/books/closing">Cash forecast, customer health and year-end</Link>
      </nav>
      <h1 className="text-2xl font-bold">Your books</h1>
      <p className="text-muted-foreground">This is the record your accountant and your tax return will use. It fills itself in from your bills, payments, refunds and expenses, so you never type entries here. Nothing on this screen sends or moves money.</p>
      {notice&&<p role="status" className="rounded border border-border p-3">{notice}</p>}
    </header>
    {!model.settings?.booksStartDate ? <section className="rounded-lg border border-border p-4 space-y-3">
      <h2 className="text-lg font-semibold">Start your books</h2>
      <p>Get the business&apos;s starting date and balances in order using four simple steps. You can correct an opening balance later without changing the original record.</p>
      {owner?<Link href="/desk/books/setup" className={button}>Set up my books</Link>:
       <p>Ask the owner to set up the books. Your existing access stays unchanged.</p>}
    </section>:<section className="rounded-lg border border-border p-4 space-y-3">
      <h2 className="text-lg font-semibold">Money in and out, month by month</h2>
      <p>Started {formatBusinessDate(model.settings.booksStartDate)}. Entries are never edited or deleted. If something was wrong, the app adds a second entry that cancels it, so there is always a clear trail.</p>
      {opening&&<OpeningCorrectionSheet
        opening={{bankCents:opening.bankCents,stripeCents:opening.stripeCents,
          cardCents:opening.cardCents}}/>}
      <form action={postBooksAction}><button type="submit" className={button}>Bring the books up to date</button></form>
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <label>Month <input className={input} type="month" name="month" defaultValue={selected}/></label>
        <button type="submit" className={button}>View this month</button>
        <Link className="underline" href="/desk/books">All entries</Link>
        <a className="underline" href={"/desk/books/export?month="+encodeURIComponent(selected)}>Download this month for your accountant (CSV)</a>
      </form>
      <div className="overflow-x-auto"><table className="min-w-full text-sm">
        <caption className="text-left text-muted-foreground pb-2">{model.total} entries; 30 per page</caption>
        <thead><tr className="border-b border-border text-left"><th scope="col">Date</th><th scope="col">Where it came from</th><th scope="col">What changed (debit and credit are bookkeeping words your accountant knows)</th></tr></thead>
        <tbody>{model.entries.map(entry=><tr className="border-b border-border align-top" key={entry.id}>
          <td className="p-2 whitespace-nowrap">{formatBusinessDate(entry.entryDate)}<p>#{entry.entryNumber}</p>{entry.lateForDate&&<p>Late for {formatBusinessDate(entry.lateForDate)}</p>}</td>
          <td className="p-2 break-all">{sourceLabel(entry.sourceType)}<p className="text-xs text-muted-foreground">Reference {entry.sourceId.slice(0,10)}</p></td>
          <td className="p-2"><p className="font-medium">{entry.memo}</p>{entry.lines.map(line=><p key={line.id} className="flex gap-3 justify-between">
            <span>{line.ledgerAccount.name}</span><span className="tabular-nums">{line.debitCents?formatMoney(line.debitCents)+" debit":formatMoney(line.creditCents)+" credit"}</span></p>)}</td>
        </tr>)}</tbody>
      </table></div>
      <nav aria-label="Journal pages" className="flex gap-4">
        {model.page>1&&<Link className="underline" href={`/desk/books?month=${model.month??""}&page=${model.page-1}`}>Previous</Link>}
        {model.page*30<model.total&&<Link className="underline" href={`/desk/books?month=${model.month??""}&page=${model.page+1}`}>Next</Link>}
      </nav>
      <p className="text-sm text-muted-foreground">Months you have locked: {model.periods.length?model.periods.map(p=>p.periodKey+" "+(p.status==="CLOSED"?"locked":"open")).join(" · "):"none yet, every month is still open"}</p>
      {owner&&<div className="grid gap-4 sm:grid-cols-2">
        <form action={closeMonthAction} className="space-y-2 rounded border border-border p-3">
          <h3 className="font-semibold">Lock a month once you have checked it</h3>
          <p>Download the month for your accountant first. After you lock it, anything that turns up late is recorded in the next open month instead.</p>
          <input type="hidden" name="month" value={selected}/><button className={button} type="submit">Lock {selected}</button>
        </form>
        <form action={reopenMonthAction} className="space-y-2 rounded border border-border p-3">
          <h3 className="font-semibold">Unlock a month</h3>
          <input type="hidden" name="month" value={selected}/>
          <label>Why are you unlocking this month? (kept in the activity log)<input className={input} name="reason" required maxLength={300}/></label>
          <button className={button} type="submit">Unlock {selected}</button>
        </form>
      </div>}
    </section>}
    {model.issues.length>0&&<section className="rounded-lg border border-border p-4 space-y-2">
      <h2 className="text-lg font-semibold">Things the books could not record</h2>
      <p>These were not fully recorded. Open the bill or expense behind each one, fix what is wrong, then press &ldquo;Bring the books up to date&rdquo;.</p>
      <ul className="space-y-2">{model.issues.map(issue=><li key={issue.id} className="border-t border-border py-2">
        <p className="font-semibold">{issue.summary}</p><p className="text-sm">{issue.detail}</p>
        <p className="text-xs text-muted-foreground">Detected {issue.occurrences} time(s).</p>
      </li>)}</ul>
    </section>}
    <section className="rounded-lg border border-border p-4 space-y-3">
      <h2 className="text-lg font-semibold">Your accounts</h2>
      <p className="text-sm text-muted-foreground">Accounts are the buckets your money is sorted into (cash, what customers owe you, rent income, expenses and so on). You can rename them or match them to QuickBooks or Xero. Renaming never changes past entries.</p>
      <div className="space-y-2">{model.accounts.map(a=><div className="grid gap-2 border-t border-border py-3 sm:grid-cols-3" key={a.id}>
        <div><p className="font-semibold">{a.name}</p><p className="text-xs text-muted-foreground">{a.type} · {a.description}</p><p className="font-medium">Net change so far: {formatMoney((model.balances.find(row=>row.ledgerAccountId===a.id)?._sum.debitCents??0)-(model.balances.find(row=>row.ledgerAccountId===a.id)?._sum.creditCents??0))}</p></div>
        {owner?<form action={renameAccountAction} className="flex gap-2 items-end">
          <input type="hidden" name="accountId" value={a.id}/><label className="flex-1">Account name<input className={input} name="name" defaultValue={a.name} maxLength={120}/></label><button className={button}>Save</button>
        </form>:<p>{a.name}</p>}
        {owner?<form action={mapExportAccountAction} className="flex flex-wrap gap-2 items-end">
          <input type="hidden" name="accountId" value={a.id}/>
          <label>Export to<select name="target" className={input}><option value="GENERIC_JOURNAL_CSV">Generic CSV</option><option value="QBO_JOURNAL_CSV">QuickBooks</option><option value="XERO_JOURNAL_CSV">Xero</option><option value="CASH_MOVEMENTS_CSV">Cash movements</option></select></label>
          <label className="flex-1">External account<input name="externalName" className={input} placeholder="Account name or code" required/></label>
          <label>Xero tax rate (optional)<input name="externalTaxRate" className={input} placeholder="Tax Exempt" maxLength={120}/></label>
          <button className={button}>Map</button>
        </form>:<p>{a.mappings.length} saved export mappings</p>}
      </div>)}</div>
      {owner&&<form action={createAccountAction} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
        <h3 className="col-span-full font-semibold">Add an account</h3>
        <label>Name<input className={input} name="name" required/></label><label>Description<input className={input} name="description" required/></label>
        <label>Type<select className={input} name="type"><option value="ASSET">Something I own</option><option value="LIABILITY">Something I owe</option><option value="EXPENSE">A cost of doing business</option></select></label>
        <label className="flex gap-2 items-center"><input type="checkbox" name="isPaymentSource"/> Can pay expenses from this account</label>
        <button type="submit" className={button}>Add account</button>
      </form>}
    </section>
  </div>;
}
