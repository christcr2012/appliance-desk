import Link from "next/link";
import { requireRole } from "@/lib/session";
import { businessDateKey, formatBusinessDate } from "@/lib/business-date";
import { formatMoney, moneyInputValue } from "@/lib/money-ui";
import { getExpenses } from "@/domains/books/expenses";
import { createExpenseAction, postExpenseAction, voidExpenseAction, saveRecurringAction } from "./actions";
import { ExpenseReceiptUpload } from "./receipt-upload";

export const metadata = { title: "Expenses — Books" };
const field = "min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const button = "rounded border border-border bg-card px-3 py-2 font-semibold text-foreground hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2";
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ status?: string; notice?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const params = await searchParams;
  const data = await getExpenses(session.user.id, params.status);
  const notice = params.notice?.slice(0, 250);
  return <div className="space-y-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-bold">Expenses</h1>
      <p className="text-muted-foreground">Record a cost without sending a payment. Staff submit their own expenses; the owner or an admin approves the accounting entry.</p>
      {data.manager && <Link href="/desk/books" className="underline">View accounting journal and balances</Link>}
      {notice && <p role="status" className="rounded border border-border p-3">{notice}</p>}
    </header>
    <section className="rounded-lg border border-border p-4 space-y-3">
      <h2 className="text-lg font-semibold">Record an expense</h2>
      <p>First save the expense, then upload its private receipt below. Seller tax is included in the amount paid.</p>
      <form action={createExpenseAction} className="grid gap-3 sm:grid-cols-2">
        <label>Date paid (Colorado)<input className={field} name="date" type="date" defaultValue={businessDateKey(new Date())} required/></label>
        <label>Total paid ($)<input className={field} name="amount" type="text" inputMode="decimal" placeholder="0.00" required/></label>
        <label>Seller tax already included ($)<input className={field} name="vendorTax" type="text" inputMode="decimal" defaultValue="0.00" required/></label>
        <label>Vendor<input className={field} name="vendor" maxLength={160} required/></label>
        <label>Category<select className={field} name="categoryId" required>
          <option value="">Select a category</option>{data.categories.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select></label>
        <label>Paid from<select className={field} name="paidFromAccountId" required>
          <option value="">Select an account</option>{data.payments.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select></label>
        <label className="sm:col-span-2">Description (optional)<textarea name="memo" maxLength={500} className={field} rows={2}/></label>
        {data.manager && <div className="sm:col-span-2 grid gap-2 sm:grid-cols-3">
          <label>Appliance ID (optional)<input className={field} name="applianceId"/></label>
          <label>Job ID (optional)<input className={field} name="jobId"/></label>
          <label>Purchase order ID (optional)<input className={field} name="purchaseOrderId"/></label>
          <label className="sm:col-span-3 inline-flex gap-2 items-center"><input type="checkbox" name="capitalize"/>This bought a rental appliance (capitalize cost)</label>
        </div>}
        <div className="sm:col-span-2 flex gap-2 flex-wrap">
          {data.manager ? <>
            <button className={button} name="mode" value="DRAFT">Save draft</button>
            <button className={button} name="mode" value="POSTED">Approve and post</button>
          </> : <button className={button} name="mode" value="SUBMITTED">Submit for approval</button>}
        </div>
      </form>
    </section>
    <section className="rounded-lg border border-border p-4 space-y-3">
      <h2 className="text-lg font-semibold">{data.manager ? "Expense history and approval queue" : "My submitted expenses"}</h2>
      <nav aria-label="Expense status filters" className="flex gap-3 flex-wrap text-sm">
        {["ALL", "DRAFT", "SUBMITTED", "POSTED", "VOID"].map(x => <Link className="underline" key={x}
          href={x === "ALL" ? "/desk/expenses" : `/desk/expenses?status=${x}`}>{x === "ALL" ? "All" : x.toLowerCase()}</Link>)}
      </nav>
      <p>{data.rows.length} recent records (maximum 100).</p>
      <div className="space-y-3">{data.rows.map(row => <article key={row.id} className="rounded border border-border p-3 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">{row.vendorName} — {formatMoney(row.amountCents)}</h3>
          <span>{row.status}</span>
        </div>
        <p className="text-sm">{formatBusinessDate(row.spentOn)} · {row.category.name} · seller tax {formatMoney(row.vendorTaxCents)}</p>
        {row.memo && <p>{row.memo}</p>}
        {row.receiptPhotoId ? <a className="underline" href={`/api/photos/${encodeURIComponent(row.receiptPhotoId)}`}>View private receipt</a> :
          row.status !== "VOID" ? <ExpenseReceiptUpload id={row.id}/> : <p>No receipt attached.</p>}
        {data.manager && (row.status === "DRAFT" || row.status === "SUBMITTED") && <form action={postExpenseAction}>
          <input type="hidden" name="id" value={row.id}/><input type="hidden" name="version" value={row.version}/>
          <button className={button}>Approve and post</button>
        </form>}
        {data.manager && row.status === "POSTED" && <form action={voidExpenseAction} className="flex gap-2 flex-wrap items-end">
          <input type="hidden" name="id" value={row.id}/><input type="hidden" name="version" value={row.version}/>
          <label className="flex-1 min-w-44">Reason for reversal<input name="reason" required maxLength={300} className={field}/></label>
          <button className={button}>Void with reversal</button>
        </form>}
      </article>)}</div>
    </section>
    {data.manager && <section className="rounded-lg border border-border p-4 space-y-3">
      <h2 className="text-lg font-semibold">Recurring expense drafts</h2>
      <p>These create a draft for review each month. No expense is posted or paid automatically.</p>
      <form action={saveRecurringAction} className="grid gap-3 sm:grid-cols-2">
        <label>Template name<input required name="name" className={field}/></label>
        <label>Vendor<input required name="vendor" className={field}/></label>
        <label>Monthly amount ($)<input required name="amount" inputMode="decimal" placeholder="0.00" className={field}/></label>
        <label>Day of month (1–28)<input required type="number" name="day" min={1} max={28} className={field}/></label>
        <label>Category<select required name="categoryId" className={field}>
          <option value="">Choose</option>{data.categories.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
        </select></label>
        <label>Paid from<select required name="paidFromAccountId" className={field}>
          <option value="">Choose</option>{data.payments.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
        </select></label>
        <label className="flex gap-2 items-center"><input type="checkbox" name="active" defaultChecked/>Active</label>
        <button className={button}>Create recurring template</button>
      </form>
      <ul className="space-y-3">{data.templates.map(t => <li key={t.id} className="border-t border-border pt-2">
        <p>{t.name} — {formatMoney(t.amountCents)} on day {t.dayOfMonth} · {t.active ? "Active" : "Paused"} · last draft {t.lastCreatedFor || "none"}</p>
        <details className="space-y-2">
          <summary className="cursor-pointer underline">Edit recurring template</summary>
          <form action={saveRecurringAction} className="grid gap-2 sm:grid-cols-2 mt-2">
            <input type="hidden" name="id" value={t.id}/>
            <label>Template name<input className={field} name="name" defaultValue={t.name} required/></label>
            <label>Vendor<input className={field} name="vendor" defaultValue={t.vendorName} required/></label>
            <label>Monthly amount ($)<input className={field} name="amount" defaultValue={moneyInputValue(t.amountCents)} required/></label>
            <label>Day of month<input className={field} name="day" type="number" min={1} max={28} defaultValue={t.dayOfMonth} required/></label>
            <label>Category<select name="categoryId" className={field} defaultValue={t.categoryId} required>
              {data.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Paid from<select name="paidFromAccountId" className={field} defaultValue={t.paidFromAccountId} required>
              {data.payments.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label><input name="active" type="checkbox" defaultChecked={t.active}/>Active</label>
            <button className={button}>Save recurring changes</button>
          </form>
        </details>
        <form action={saveRecurringAction} className="flex gap-2 items-end flex-wrap">
          <input type="hidden" name="id" value={t.id}/><input type="hidden" name="name" value={t.name}/>
          <input type="hidden" name="vendor" value={t.vendorName}/><input type="hidden" name="amount" value={moneyInputValue(t.amountCents)}/>
          <input type="hidden" name="day" value={t.dayOfMonth}/><input type="hidden" name="categoryId" value={t.categoryId}/>
          <input type="hidden" name="paidFromAccountId" value={t.paidFromAccountId}/>
          <input type="hidden" name="active" value={t.active ? "off" : "on"}/>
          <button className={button}>{t.active ? "Pause" : "Activate"} template</button>
        </form>
      </li>)}</ul>
    </section>}
  </div>;
}
