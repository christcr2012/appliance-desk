import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getShownFeatures } from "@/domains/features";
import { isHrefHidden } from "@/domains/features/registry";
import { getBooksWorkspace } from "@/domains/books/management";
import { getBookAssets } from "@/domains/books/fixed-assets";
import { lastCompletedMonth } from "@/domains/books/depreciation";
import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { DataTable, EmptyState, ScreenHeader, TaskCard, Toaster } from "@/components/kit";
import {
  renameAccountAction, createAccountAction, mapExportAccountAction,
} from "../actions";
import {
  bookAssetPolicyAction, bookTaxEvidenceAction, enrollBookAssetAction,
  postBookDepreciationAction, retireBookAssetAction,
} from "../assets/actions";
import { listAccountantChanges, markAccountantChangesSeen } from "@/domains/accountant";

export const metadata = { title: "For your accountant — Books" };
const input = "min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";
const button = "rounded border border-border bg-card px-3 py-2 text-foreground font-medium hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2";
const field = "min-w-0 w-full rounded border border-border bg-background px-3 py-2 text-foreground";

const SOURCE_LABEL: Record<string, string> = {
  INVOICE: "A bill to a customer", PAYMENT: "A customer payment", REFUND: "A refund", EXPENSE: "A business expense",
  CUSTOMER_CREDIT: "Credit on a customer's account", APPLIANCE: "An appliance you own", USE_TAX: "Use tax you owe",
  TAX_FILING: "A tax filing", OPENING: "Your starting balances", HELD_PAYMENT: "A payment held for review",
  ADJUSTMENT: "An adjusting entry",
  STRIPE_BALANCE_TXN: "A Stripe card transaction", RECURRING_EXPENSE: "A repeating expense",
};
const sourceLabel = (type: string) => SOURCE_LABEL[type.toUpperCase()] ?? type.replace(/_/g, " ").toLowerCase();

const TYPE_WORDS: Record<string, string> = {
  ASSET: "Something you own", LIABILITY: "Something you owe", EQUITY: "Your share",
  INCOME: "Money earned", EXPENSE: "Money spent",
  CONTRA_ASSET: "Reduces something you own", CONTRA_INCOME: "Reduces money earned",
};

// AR-7 (BOOKS-TAXES 1.5): For your accountant. The full journal and the account forms moved here
// from /desk/books unchanged (same getBooksWorkspace data, same actions); the manual book-asset
// forms moved here from Equipment value behind "Fix a book asset by hand".
export default async function BooksAccountantPage({ searchParams }: { searchParams: Promise<{ month?: string; page?: string; notice?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  const params = await searchParams;
  const shown = await getShownFeatures();
  const owner = session.user.role === "OWNER";
  const accountant = session.user.role === "ACCOUNTANT";
  const feed = !accountant ? await listAccountantChanges(session.user.id).catch(() => []) : [];
  if (owner && feed.length > 0) await markAccountantChangesSeen(session.user.id).catch(() => {});
  const model = await getBooksWorkspace({ id: session.user.id, role: session.user.role }, {
    month: params.month, page: Number(params.page) || 1,
  });
  const selected = params.month ?? new Date().toISOString().slice(0, 7);
  const notice = params.notice?.slice(0, 200);
  const assets = model.settings?.booksStartDate ? await getBookAssets(session.user.id) : null;
  const now = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <Toaster />
      <ScreenHeader title="For your accountant" />
      <p className="text-sm text-ink-soft">Your accountant may ask for these. You don&apos;t need them to run the business.</p>
      {notice ? <p role="status" className="rounded-card border border-line bg-surface p-3 text-sm">{notice}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2">
        {!isHrefHidden("/desk/books/exports", shown) ? (
          <TaskCard title="Exports" href="/desk/books/exports" info="The exports page: QuickBooks, Xero and CSV downloads, and the QuickBooks trial checklist." status={{ label: "Downloads", tone: "neutral" }} />
        ) : null}
        <TaskCard title="Year-end package" href="/desk/books/reports?view=cash-and-customers" info="The year-end figures your accountant asks for, with the cash forecast and who pays on time." status={{ label: "In Reports", tone: "neutral" }} />
        {!isHrefHidden("/desk/books/cash", shown) ? (
          <TaskCard title="Bank statements and cash records" href="/desk/books/cash" info="Bank statements and cash records, matched against the books." status={{ label: "Statements", tone: "neutral" }} />
        ) : null}
      </section>

      {feed.length > 0 ? (
        <section className="rounded-card border border-line bg-surface p-4 space-y-3">
          <h2 className="text-lg font-semibold">Changes by your accountant</h2>
          <p className="text-sm text-ink-soft">Everything your accountant changed, newest first. Adjusting entries can be reversed from the month they are dated in.</p>
          <ul className="space-y-2">{feed.map((row) => (
            <li key={row.id} className="border-t border-line py-2">
              <p className="font-medium">{row.summary}</p>
              <p className="text-xs text-ink-soft">{row.actorName}{row.actorFirm ? ` (${row.actorFirm})` : ""} · {formatBusinessDate(row.at)}{row.href ? <> · <Link className="underline" href={row.href}>Open</Link></> : null}</p>
            </li>
          ))}</ul>
        </section>
      ) : null}

      {!model.settings?.booksStartDate ? (
        <section className="rounded-card border border-line bg-surface p-4 space-y-3">
          <h2 className="text-lg font-semibold">Start your books</h2>
          <p>Get the business&apos;s starting date and balances in order using four simple steps.</p>
          <p>You can correct an opening balance later without changing the original record.</p>
          {owner ? <Link href="/desk/books/setup" className={button}>Set up my books</Link> : <p>Ask the owner to set up the books. Your existing access stays unchanged.</p>}
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Full journal</h2>
            <p className="text-sm text-ink-soft">Started {formatBusinessDate(model.settings.booksStartDate)}. Entries are never edited or deleted. If something was wrong, the app adds a second entry that cancels it, so there is always a clear trail.</p>
            <form method="GET" className="flex flex-wrap items-end gap-3">
              <label>Month <input className={input} type="month" name="month" defaultValue={selected} /></label>
              <button type="submit" className={button}>View this month</button>
              <Link className="underline" href="/desk/books/accountant">All entries</Link>
              {!isHrefHidden("/desk/books/export", shown) ? <a className="underline" href={"/desk/books/export?month=" + encodeURIComponent(selected)}>Download this month for your accountant (CSV)</a> : null}
            </form>
            <DataTable
              caption={`${model.total} entries; 30 per page`}
              rows={model.entries}
              rowKey={(entry) => entry.id}
              empty={<EmptyState title="No entries this month" />}
              columns={[
                {
                  key: "date", header: "Date",
                  cell: (entry) => (<>{formatBusinessDate(entry.entryDate)}<p>#{entry.entryNumber}</p>{entry.lateForDate ? <p>Late for {formatBusinessDate(entry.lateForDate)}</p> : null}</>),
                },
                {
                  key: "source", header: "Where it came from",
                  cell: (entry) => (<>{sourceLabel(entry.sourceType)}<p className="text-xs text-ink-soft">Reference {entry.sourceId.slice(0, 10)}</p></>),
                },
                {
                  key: "change", header: "What changed (debit and credit are bookkeeping words your accountant knows)",
                  cell: (entry) => (<><p className="font-medium">{entry.memo}</p>{entry.lines.map((line) => (
                    <p key={line.id} className="flex gap-3 justify-between">
                      <span>{line.ledgerAccount.name}</span>
                      <span className="tabular-nums">{line.debitCents ? formatMoney(line.debitCents) + " debit" : formatMoney(line.creditCents) + " credit"}</span>
                    </p>
                  ))}</>),
                },
              ]}
              mobileCard={(entry) => (
                <div className="space-y-1">
                  <p className="font-medium">{entry.memo}</p>
                  <p className="text-xs text-ink-soft">{formatBusinessDate(entry.entryDate)} · #{entry.entryNumber} · {sourceLabel(entry.sourceType)}</p>
                  {entry.lines.map((line) => (
                    <p key={line.id} className="flex gap-3 justify-between text-sm">
                      <span>{line.ledgerAccount.name}</span>
                      <span className="tabular-nums">{line.debitCents ? formatMoney(line.debitCents) + " debit" : formatMoney(line.creditCents) + " credit"}</span>
                    </p>
                  ))}
                </div>
              )}
            />
            <nav aria-label="Journal pages" className="flex gap-4">
              {model.page > 1 ? <Link className="underline" href={`/desk/books/accountant?month=${model.month ?? ""}&page=${model.page - 1}`}>Previous</Link> : null}
              {model.page * 30 < model.total ? <Link className="underline" href={`/desk/books/accountant?month=${model.month ?? ""}&page=${model.page + 1}`}>Next</Link> : null}
            </nav>
            <p className="text-sm text-ink-soft">Months you have locked: {model.periods.length ? model.periods.map((p) => p.periodKey + " " + (p.status === "CLOSED" ? "locked" : "open")).join(" · ") : "none yet, every month is still open"}</p>
            <div className="space-y-2 rounded-card border border-line bg-surface p-3">
              <h3 className="font-semibold">Review this month before locking it</h3>
              <p>Check source records, receipts, payments and depreciation.</p>
              <p>The owner can lock a completed month after its required checks. Admins can review it.</p>
              <Link className={button} href={"/desk/books/months/" + selected}>Review {selected}</Link>
            </div>
          </section>

          {model.issues.length > 0 ? (
            <section className="rounded-card border border-line bg-surface p-4 space-y-2">
              <h2 className="text-lg font-semibold">Things the books could not record</h2>
              <p>These were not fully recorded.</p>
              <p>Open the bill or expense behind each one, fix what is wrong, then press &ldquo;Update now&rdquo; on the Books overview.</p>
              <ul className="space-y-2">{model.issues.map((issue) => (
                <li key={issue.id} className="border-t border-line py-2">
                  <p className="font-semibold">{issue.summary}</p><p className="text-sm">{issue.detail}</p>
                  <p className="text-xs text-ink-soft">Detected {issue.occurrences} time(s).</p>
                </li>
              ))}</ul>
            </section>
          ) : null}

          <section className="rounded-card border border-line bg-surface p-4 space-y-3">
            <h2 className="text-lg font-semibold">Accounts and QuickBooks/Xero names</h2>
            <p className="text-sm text-ink-soft">Accounts are the buckets your money is sorted into (cash, what customers owe you, rent income, expenses and so on).</p>
            <p className="text-sm text-ink-soft">You can rename them or match them to QuickBooks or Xero. Renaming never changes past entries.</p>
            <div className="space-y-2">{model.accounts.map((a) => (
              <div className="grid gap-2 border-t border-line py-3 sm:grid-cols-3" key={a.id}>
                <div>
                  <p className="font-semibold">{a.name}</p>
                  <p className="text-xs text-ink-soft">{TYPE_WORDS[a.type] ?? a.type} · {a.description}</p>
                  <p className="font-medium">Net change so far: {formatMoney((model.balances.find((row) => row.ledgerAccountId === a.id)?._sum.debitCents ?? 0) - (model.balances.find((row) => row.ledgerAccountId === a.id)?._sum.creditCents ?? 0))}</p>
                </div>
                {owner ? (
                  <form action={renameAccountAction} className="flex gap-2 items-end">
                    <input type="hidden" name="accountId" value={a.id} />
                    <label className="flex-1">Account name<input className={input} name="name" defaultValue={a.name} maxLength={120} /></label>
                    <button className={button}>Save</button>
                  </form>
                ) : <p>{a.name}</p>}
                {owner || accountant ? (
                  <form action={mapExportAccountAction} className="flex flex-wrap gap-2 items-end">
                    <input type="hidden" name="accountId" value={a.id} />
                    <label>Export to<select name="target" className={input}><option value="GENERIC_JOURNAL_CSV">Generic CSV</option><option value="QBO_JOURNAL_CSV">QuickBooks</option><option value="XERO_JOURNAL_CSV">Xero</option><option value="CASH_MOVEMENTS_CSV">Cash movements</option></select></label>
                    <label className="flex-1">External account<input name="externalName" className={input} placeholder="Account name or code" required /></label>
                    <label>Xero tax rate (optional)<input name="externalTaxRate" className={input} placeholder="Tax Exempt" maxLength={120} /></label>
                    <button className={button}>Map</button>
                  </form>
                ) : <p>{a.mappings.length} saved export mappings</p>}
              </div>
            ))}</div>
            {owner ? (
              <form action={createAccountAction} className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                <h3 className="col-span-full font-semibold">Add an account</h3>
                <label>Name<input className={input} name="name" required /></label>
                <label>Description<input className={input} name="description" required /></label>
                <label>Type<select className={input} name="type"><option value="ASSET">Something I own</option><option value="LIABILITY">Something I owe</option><option value="EXPENSE">A cost of doing business</option></select></label>
                <label className="flex gap-2 items-center"><input type="checkbox" name="isPaymentSource" /> Can pay expenses from this account</label>
                <button type="submit" className={button}>Add account</button>
              </form>
            ) : null}
          </section>

          {assets ? (
            <section className="rounded-card border border-line bg-surface p-4 space-y-3">
              <h2 className="text-lg font-semibold">Book asset tax details</h2>
              <p className="text-sm text-ink-soft">No income-tax basis or depreciation recapture is calculated from these book values. Incomplete evidence remains pending accountant review.</p>
              {assets.assets.length === 0 ? <p>No enrolled rental equipment yet.</p> : assets.assets.map((a) => (
                <article className="border-t border-line pt-3 space-y-2" key={a.applianceId}>
                  <h3 className="font-semibold">{a.appliance.assetNumber}</h3>
                  {a.taxEvidence.length ? a.taxEvidence.map((e) => (
                    <p key={e.id} className="text-sm border-t border-line py-2">
                      {e.classification} · {e.confidence} · as of {formatBusinessDate(e.evidenceAsOf)} · source: {e.sourceReference}
                      {e.originalBasisCents !== null ? <> · Tax basis evidence {formatMoney(e.originalBasisCents)}</> : null}
                      {e.cpaName ? <> · CPA {e.cpaName}</> : null}
                    </p>
                  )) : <p>Not recorded — tax basis unknown, CPA review required.</p>}
                  {owner || accountant ? (
                    <details className="border border-line rounded p-3">
                      <summary className="cursor-pointer font-medium">Record new CPA / tax-basis evidence (append-only)</summary>
                      <form action={bookTaxEvidenceAction} className="grid gap-3 sm:grid-cols-2 mt-3">
                        <input type="hidden" name="applianceId" value={a.applianceId} />
                        <label>Asset classification<select className={field} name="classification"><option value="UNKNOWN">Unknown</option><option value="RENTAL_ASSET">Rental fixed asset</option><option value="EXPENSED">Expensed</option><option value="INVENTORY">Inventory</option><option value="OTHER">Other</option></select></label>
                        <label>Basis verification<select className={field} name="confidence"><option value="UNKNOWN">Unknown</option><option value="OWNER_SUPPLIED">Owner supplied, unconfirmed</option><option value="CPA_CONFIRMED">CPA confirmed</option></select></label>
                        <label>Original tax basis ($)<input className={field} name="originalBasis" inputMode="decimal" placeholder="Unconfirmed" /></label>
                        <label>Signed basis adjustments ($)<input className={field} name="adjustments" inputMode="decimal" placeholder="e.g. -25.00" /></label>
                        <label>Allowed / allowable depreciation ($)<input className={field} name="allowed" inputMode="decimal" /></label>
                        <label>Section 179 deductions ($)<input className={field} name="section179" inputMode="decimal" /></label>
                        <label>Bonus depreciation ($)<input className={field} name="bonus" inputMode="decimal" /></label>
                        <label>Source as-of date<input className={field} type="date" name="evidenceDate" defaultValue={now} required /></label>
                        <label>Named CPA (if confirmed)<input className={field} name="cpaName" maxLength={120} /></label>
                        <label>Evidence reference<input className={field} name="sourceReference" maxLength={300} required /></label>
                        <button className={button}>Append tax evidence</button>
                      </form>
                    </details>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}

          {owner && assets ? (
            <section className="rounded-card border border-line bg-surface p-4 space-y-3">
              <h2 className="text-lg font-semibold">Fix a book asset by hand</h2>
              <p className="text-sm text-ink-soft">Enrollment and monthly entries are automatic. These forms stay for recovery, when the automatic step could not do it.</p>
              {assets.candidates.length ? (
                <form action={enrollBookAssetAction} className="grid gap-3 sm:grid-cols-3">
                  <label>Appliance<select name="applianceId" required className={field}>
                    {assets.candidates.map((x) => <option key={x.id} value={x.id}>{x.assetNumber} — {formatMoney(x.acquisitionCostCents ?? 0)}</option>)}
                  </select></label>
                  <label>In-service book date<input type="date" name="placedDate" defaultValue={assets.settings?.booksStartDate ? assets.settings.booksStartDate.toISOString().slice(0, 10) : now} required className={field} /></label>
                  <button className={button}>Enroll in book assets</button>
                </form>
              ) : <p>No untracked appliances with acquisition costs are available.</p>}
              {assets.assets.filter((a) => !a.retiredOn).map((a) => (
                <div className="grid gap-3 lg:grid-cols-2 border-t border-line pt-3" key={a.applianceId}>
                  <form action={postBookDepreciationAction} className="rounded border border-line p-3 space-y-2">
                    <h4 className="font-semibold">{a.appliance.assetNumber} — Post completed month(s)</h4>
                    <input type="hidden" name="applianceId" value={a.applianceId} />
                    <label>Through Colorado month<input className={field} name="throughMonth" type="month" defaultValue={lastCompletedMonth()} required /></label>
                    <button className={button}>Post depreciation</button>
                  </form>
                  <form action={bookAssetPolicyAction} className="rounded border border-line p-3 space-y-2">
                    <h4 className="font-semibold">{a.appliance.assetNumber} — Future book life and salvage</h4>
                    <input type="hidden" name="applianceId" value={a.applianceId} />
                    <input type="hidden" name="version" value={a.version} />
                    <label>Useful life (months)<input name="lifeMonths" className={field} type="number" min={1} max={360} defaultValue={a.lifeMonths} required /></label>
                    <label>Salvage percent<input name="salvagePercent" className={field} type="number" min={0} max={95} defaultValue={a.salvagePercent} required /></label>
                    <button className={button}>Save future-only policy</button>
                  </form>
                  {a.appliance.status === "RETIRED" ? (
                    <form action={retireBookAssetAction} className="rounded border border-line p-3 space-y-2 lg:col-span-2">
                      <h4 className="font-semibold">{a.appliance.assetNumber} — Hold retired value pending final disposition</h4>
                      <p>Post all completed depreciation first. This does not record a sale, tax gain, write-off or disposal loss.</p>
                      <input type="hidden" name="applianceId" value={a.applianceId} />
                      <input type="hidden" name="version" value={a.version} />
                      <label>Disposition intention<select name="intent" className={field} required>
                        <option value="DECIDE_LATER">Decide later</option><option value="SELL">Sell</option>
                        <option value="SCRAP">Scrap</option><option value="STRIP">Strip for parts</option>
                        <option value="DISPOSE">Dispose</option><option value="DONATE_OTHER">Donate / other</option>
                      </select></label>
                      <label>Removed from rental service<input type="date" name="retiredDate" className={field} defaultValue={now} required /></label>
                      <button className={button}>Record pending-retirement asset</button>
                    </form>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
