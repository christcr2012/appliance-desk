import Link from "next/link";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import { lastCompletedMonth } from "@/domains/books/depreciation";
import { ScreenHeader, StatusPill } from "@/components/kit";

export const metadata = { title: "Month by month — Books" };

const MONTH_NAME = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (key: string) => `${MONTH_NAME[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const nextKey = (key: string) => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

// AR-7 (BOOKS-TAXES 1.2): every month from the books start to the current month, newest first.
// Locked = the period is CLOSED; an ended month still open is Ready to review; the current
// month is Open. Each row's Review button opens the BA-3 month review page.
export default async function BooksMonthsPage() {
  await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { booksStartDate: true },
  });
  if (!settings?.booksStartDate) {
    return (
      <div className="flex flex-col gap-6">
        <ScreenHeader title="Month by month" />
        <p className="text-sm text-ink-soft">Your books are not set up yet. Months appear here once the owner sets them up.</p>
      </div>
    );
  }
  const firstKey = businessDateKey(settings.booksStartDate).slice(0, 7);
  const currentKey = businessDateKey(new Date()).slice(0, 7);
  const lastEnded = lastCompletedMonth(new Date());
  const periods = await prisma.accountingPeriod.findMany({
    where: { periodKey: { gte: firstKey, lte: currentKey } },
    select: { periodKey: true, status: true },
  });
  const statusByKey = new Map(periods.map((p) => [p.periodKey, p.status]));
  const keys: string[] = [];
  for (let key = firstKey; key <= currentKey; key = nextKey(key)) keys.push(key);
  keys.reverse();

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader title="Month by month" />
      <ul className="flex flex-col gap-2">
        {keys.map((key) => {
          const closed = statusByKey.get(key) === "CLOSED";
          const pill = closed
            ? { label: "Locked", tone: "good" as const }
            : key <= lastEnded
              ? { label: "Ready to review", tone: "attention" as const }
              : { label: "Open", tone: "neutral" as const };
          return (
            <li key={key} className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
              <span className="flex items-center gap-3">
                <span className="font-semibold">{monthLabel(key)}</span>
                <StatusPill label={pill.label} tone={pill.tone} />
              </span>
              <Link href={`/desk/books/months/${key}`} className="rounded-field border border-line px-3 py-2 text-sm font-bold">Review</Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
