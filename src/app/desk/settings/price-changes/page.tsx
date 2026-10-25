import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import {
  cancelScheduledPriceChange,
  earliestStartDay,
  listScheduledPriceChanges,
  previewScheduledPriceChange,
  scheduleAppliancePriceChange,
  schedulePackagePriceChange,
  type ScheduledPriceRow,
} from "@/domains/pricing/scheduled";

export const metadata = { title: "Price changes", robots: { index: false, follow: false } };

const BASE = "/desk/settings/price-changes";

function dollarsToCents(raw: FormDataEntryValue | null): number {
  const text = typeof raw === "string" ? raw.trim().replace(/^\$/, "") : "";
  if (!/^[0-9]{1,6}(\.[0-9]{1,2})?$/.test(text)) throw new Error("Enter the new monthly price in dollars, like 60 or 62.50.");
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Only plain, written-for-the-owner messages are shown; anything from the database becomes a generic line. */
function plainMessage(e: unknown): string {
  if (e instanceof Error && !("code" in e) && !("meta" in e)) return e.message;
  return "Something went wrong and nothing was saved. Try again.";
}

async function schedule(form: FormData) {
  "use server";
  const session = await requireRole("OWNER", "ADMIN");
  let message: string;
  try {
    // The picker sends "appliance:<id>" or "set:<id>".
    const [kind, ...rest] = String(form.get("target") ?? "").split(":");
    const id = rest.join(":");
    const common = {
      newPriceCents: dollarsToCents(form.get("price")),
      effectiveOn: String(form.get("effectiveOn") ?? ""),
      note: String(form.get("note") ?? ""),
    };
    if (kind === "set") await schedulePackagePriceChange(session.user.id, { packageId: id, ...common });
    else if (kind === "appliance") await scheduleAppliancePriceChange(session.user.id, { applianceTypeId: id, ...common });
    else throw new Error("Pick an appliance or a set.");
    message = "saved=1";
  } catch (e) {
    message = `error=${encodeURIComponent(plainMessage(e))}`;
  }
  revalidatePath(BASE);
  redirect(`${BASE}?${message}`);
}

async function cancel(form: FormData) {
  "use server";
  const session = await requireRole("OWNER", "ADMIN");
  let message: string;
  try {
    await cancelScheduledPriceChange(session.user.id, String(form.get("changeId") ?? ""));
    message = "cancelled=1";
  } catch (e) {
    message = `error=${encodeURIComponent(plainMessage(e))}`;
  }
  revalidatePath(BASE);
  redirect(`${BASE}?${message}`);
}

const STATUS_WORDS: Record<ScheduledPriceRow["status"], string> = {
  PENDING: "Waiting",
  APPLIED: "Done",
  CANCELLED: "Cancelled",
  FAILED: "Could not be applied",
};

export default async function PriceChangesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; cancelled?: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const query = await searchParams;
  const [{ pending, recent }, preview, types, sets] = await Promise.all([
    listScheduledPriceChanges(),
    previewScheduledPriceChange(),
    prisma.applianceType.findMany({
      where: { isActive: true },
      select: { id: true, name: true, monthlyPriceCents: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      take: 100,
    }),
    prisma.rentalPackage.findMany({
      where: { isActive: true },
      select: { id: true, name: true, monthlyPriceCents: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      take: 100,
    }),
  ]);
  const tomorrow = earliestStartDay();
  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <Link href="/desk/settings" className="text-sm underline">Back to settings</Link>
      <h1 className="text-xl font-semibold">Price changes</h1>
      <p className="text-sm text-ink-soft">
        Pick an appliance or a rental set, a monthly price and the day it starts. Early that morning (Colorado time) the new price is saved for you, the same way as
        when you type it on the Settings screen, and it shows in the history. Rentals already signed keep the price they were signed at.
        Estimates you already sent keep the price on them ({preview.openEstimates} open right now). Only prices shown on your website and
        quoted from the start day on are new. You can cancel a change any time before its day.
      </p>

      {query.error && <p role="alert" className="rounded-md border border-red-700 p-3 text-sm">{query.error}</p>}
      {query.saved && <p role="status" className="rounded-md border p-3 text-sm">Saved. It will start on the day you picked.</p>}
      {query.cancelled && <p role="status" className="rounded-md border p-3 text-sm">Cancelled. The price will stay as it is.</p>}

      <form action={schedule} className="space-y-4 rounded-md border p-4">
        <h2 className="font-medium">Schedule a change</h2>
        <div className="space-y-1">
          <label htmlFor="target" className="block text-sm font-medium">Appliance or set</label>
          <select id="target" name="target" required className="min-h-11 w-full rounded-md border bg-surface p-2">
            <optgroup label="Single appliances">
              {types.map((t) => (
                <option key={t.id} value={`appliance:${t.id}`}>{t.name} (now {formatMoney(t.monthlyPriceCents)} a month)</option>
              ))}
            </optgroup>
            {sets.length > 0 && (
              <optgroup label="Sets (like a washer and dryer together)">
                {sets.map((t) => (
                  <option key={t.id} value={`set:${t.id}`}>{t.name} (now {formatMoney(t.monthlyPriceCents)} a month)</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="price" className="block text-sm font-medium">New monthly price (dollars)</label>
          <input id="price" name="price" inputMode="decimal" required placeholder="60.00" className="min-h-11 w-40 rounded-md border bg-surface p-2" />
        </div>
        <div className="space-y-1">
          <label htmlFor="effectiveOn" className="block text-sm font-medium">Starts on</label>
          <input id="effectiveOn" name="effectiveOn" type="date" min={tomorrow} required className="min-h-11 rounded-md border bg-surface p-2" />
          <p className="text-xs text-ink-soft">Must be tomorrow or later. To change a price right now, use the price on the Settings screen.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="note" className="block text-sm font-medium">Note to yourself (optional)</label>
          <input id="note" name="note" maxLength={300} className="min-h-11 w-full rounded-md border bg-surface p-2" />
        </div>
        <button type="submit" className="min-h-11 rounded-md border px-4 py-2 font-medium">Schedule this change</button>
      </form>

      <section className="space-y-2">
        <h2 className="font-medium">Waiting</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing is scheduled. Prices stay as they are.</p>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                <div className="text-sm">
                  <p className="font-medium">{r.targetName}{r.kind === "SET" ? " (set)" : ""}: {formatMoney(r.currentPriceCents)} → {formatMoney(r.newPriceCents)} a month</p>
                  <p>Starts {formatBusinessDate(r.effectiveOn)}</p>
                  {r.note && <p className="text-ink-soft">{r.note}</p>}
                </div>
                <form action={cancel}>
                  <input type="hidden" name="changeId" value={r.id} />
                  <button type="submit" className="min-h-11 rounded-md border px-3 py-2 text-sm">Cancel this change</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Recent</h2>
          <ul className="space-y-2">
            {recent.map((r) => (
              <li key={r.id} className="rounded-md border p-3 text-sm">
                <p>
                  <span className="font-medium">{r.targetName}{r.kind === "SET" ? " (set)" : ""}</span> to {formatMoney(r.newPriceCents)} a month, start day {formatBusinessDate(r.effectiveOn)} — {STATUS_WORDS[r.status]}
                </p>
                {r.status === "FAILED" && r.failureMessage && <p className="text-ink-soft">{r.failureMessage} Schedule it again once that is sorted out.</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
