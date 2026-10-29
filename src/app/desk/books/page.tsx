import Link from "next/link";
import { requireRole } from "@/lib/session";
import { formatMoney } from "@/lib/money-ui";
import { formatShortDate, relativeBusinessDay } from "@/lib/business-date";
import { getBooksHome } from "@/domains/books/home";
import { currentOpeningBalances } from "@/domains/books/management";
import { getExceptionOverview } from "@/domains/exceptions";
import { inboxActions, inboxEyebrow, inboxEyebrowTone } from "@/domains/exceptions/inbox";
import { InboxCard, ScreenHeader, StatStrip, TaskCard, Toaster } from "@/components/kit";
import { OpeningCorrectionSheet } from "./opening-correction-sheet";
import { postBooksAction } from "./actions";

export const metadata = { title: "Books" };

const MONTH_NAME = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (key: string) => `${MONTH_NAME[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const timeOf = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Denver" }).toLowerCase();

// AR-7 (BOOKS-TAXES 1.1): the Books overview. The journal and account forms moved to
// /desk/books/accountant; every number here is getBooksHome (profitAndLoss + collectedBetween).
export default async function BooksOverviewPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const session = await requireRole("OWNER","ADMIN","ACCOUNTANT");
  const params = await searchParams;
  const notice = params.notice?.slice(0, 200);
  const owner = session.user.role === "OWNER";
  const accountant = session.user.role === "ACCOUNTANT";
  const now = new Date();
  const home = await getBooksHome({ id: session.user.id, role: session.user.role }, now);

  if (!home.started) {
    return (
      <div className="flex flex-col gap-6">
        <ScreenHeader title="Books" />
        {notice ? <p role="status" className="rounded-card border border-line bg-surface p-3 text-sm">{notice}</p> : null}
        <div className="flex flex-col items-center justify-center gap-3 rounded-card bg-surface px-4 py-10 text-center">
          <p className="text-base font-bold text-ink">Set up your books (5 minutes)</p>
          {owner ? (
            <Link href="/desk/books/setup" className="rounded-field bg-action px-4 py-2.5 font-bold text-on-action">Set up my books</Link>
          ) : (
            <p className="text-sm text-ink-soft">Ask the owner to set up the books</p>
          )}
        </div>
        <section className="grid gap-3 sm:grid-cols-2">
          <TaskCard
            title="Month by month"
            href="/desk/books/months"
            info="Do this once a month: check, send to your accountant, lock."
            status={{ label: "Starts with your books setup", tone: "neutral" }}
          />
          <TaskCard
            title="Reports"
            href="/desk/books/reports"
            info="Use this when you want to know how the business is doing: profit, what you own and owe, which appliances have paid for themselves, cash coming up, who pays on time."
            status={{ label: "Starts with your books setup", tone: "neutral" }}
          />
          <TaskCard
            title="Equipment value"
            href="/desk/books/assets"
            info="Use this to see what your rental appliances are worth on paper. The app keeps it up to date."
            status={{ label: "Starts with your books setup", tone: "neutral" }}
          />
          <TaskCard
            title="For your accountant"
            href="/desk/books/accountant"
            info="Use this when your accountant asks for something."
            status={{ label: "Nothing new", tone: "neutral" }}
          />
        </section>
      </div>
    );
  }

  const exceptions = await getExceptionOverview();
  const attention = exceptions.items.filter((item) => item.category.startsWith("BOOKS_")).slice(0, 10);
  const opening = owner ? await currentOpeningBalances({ id: session.user.id, role: "OWNER" }).catch(() => null) : null;
  const upToDate = home.problemCount === 0;
  const reviewMonth = home.monthsToReview[0];
  const lastMonthName = MONTH_NAME[Number(home.lastMonthKey.slice(5, 7)) - 1];

  return (
    <div className="flex flex-col gap-6">
      <Toaster />
      <ScreenHeader title="Books" />
      {notice ? <p role="status" className="rounded-card border border-line bg-surface p-3 text-sm">{notice}</p> : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {upToDate ? (
          <p className="font-semibold text-success">
            Up to date as of {home.lastUpToDateAt ? `${relativeBusinessDay(home.lastUpToDateAt, now)} ${timeOf(home.lastUpToDateAt)}` : "now"}
          </p>
        ) : (
          <Link href="/desk/today?group=taxes" className="font-semibold text-warning-ink underline">
            Not up to date — {home.problemCount} things need you
          </Link>
        )}
        {!accountant ? (
          <form action={postBooksAction}>
            <button type="submit" className="text-sm font-medium text-ink-soft underline">Update now</button>
          </form>
        ) : null}
        {opening ? <OpeningCorrectionSheet opening={{ bankCents: opening.bankCents, stripeCents: opening.stripeCents, cardCents: opening.cardCents }} /> : null}
      </div>

      <StatStrip
        items={[
          { label: "Billed this month", value: formatMoney(home.thisMonth.billedCents), sub: `Last month ${formatMoney(home.lastMonth.billedCents)}` },
          { label: "Collected", value: formatMoney(home.thisMonth.collectedCents), sub: `Last month ${formatMoney(home.lastMonth.collectedCents)}` },
          { label: "Spent", value: formatMoney(home.thisMonth.spentCents), sub: `Last month ${formatMoney(home.lastMonth.spentCents)}` },
          {
            label: "Profit",
            value: formatMoney(home.thisMonth.profitCents),
            sub: `Last month ${formatMoney(home.lastMonth.profitCents)}`,
            tone: home.thisMonth.profitCents < 0 ? "attention" : undefined,
            info: "books-profit",
          },
        ]}
      />

      {attention.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-extrabold text-ink">Needs your attention</h2>
          {attention.map((item) => {
            const { actions, overflow } = inboxActions(item);
            return (
              <InboxCard
                key={item.todoKey ?? `${item.href}-${item.title}`}
                eyebrow={inboxEyebrow(item, now)}
                eyebrowTone={inboxEyebrowTone(item)}
                title={item.title}
                detail={item.detail}
                actions={actions}
                overflow={overflow}
                severity={item.severity === "high" ? "high" : "normal"}
              />
            );
          })}
        </section>
      ) : null}

      {reviewMonth || home.nextTaxDue ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-extrabold text-ink">Coming up</h2>
          {reviewMonth ? (
            <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
              <span className="font-medium">Review {monthLabel(reviewMonth)}</span>
              <Link href={`/desk/books/months/${reviewMonth}`} className="rounded-field border border-line px-3 py-2 text-sm font-bold">Review</Link>
            </div>
          ) : null}
          {home.nextTaxDue ? (
            <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
              <span className="font-medium">Sales tax due {formatShortDate(home.nextTaxDue.dueOn, now)}</span>
              <Link href="/desk/sales-tax" className="rounded-field border border-line px-3 py-2 text-sm font-bold">Open Taxes</Link>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
        <TaskCard
          title="Month by month"
          href="/desk/books/months"
          info="Do this once a month: check, send to your accountant, lock."
          status={reviewMonth
            ? { label: `${monthLabel(reviewMonth)} ready to review`, tone: "attention" }
            : { label: "All months locked", tone: "good" }}
        />
        <TaskCard
          title="Reports"
          href="/desk/books/reports"
          info="Use this when you want to know how the business is doing: profit, what you own and owe, which appliances have paid for themselves, cash coming up, who pays on time."
          status={{ label: `${lastMonthName} profit ${formatMoney(home.lastMonthProfitCents)}`, tone: home.lastMonthProfitCents < 0 ? "attention" : "neutral" }}
        />
        <TaskCard
          title="Equipment value"
          href="/desk/books/assets"
          info="Use this to see what your rental appliances are worth on paper. The app keeps it up to date."
          status={home.assetsNeedingPrice > 0
            ? { label: `${home.assetsNeedingPrice} need${home.assetsNeedingPrice === 1 ? "s" : ""} a purchase price`, tone: "attention" }
            : { label: `${home.assetCount} appliances, all recorded`, tone: "good" }}
        />
        <TaskCard
          title="For your accountant"
          href="/desk/books/accountant"
          info="Use this when your accountant asks for something."
          status={home.accountantPackageMonth
            ? { label: `${monthLabel(home.accountantPackageMonth)} package ready`, tone: "good" }
            : { label: "Nothing new", tone: "neutral" }}
        />
      </section>
    </div>
  );
}
