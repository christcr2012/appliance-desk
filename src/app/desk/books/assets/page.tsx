import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getBookAssets } from "@/domains/books/fixed-assets";
import { businessDateKey, formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { ScreenHeader, StatStrip, StatusPill, Toaster } from "@/components/kit";
import { bookDefaultsAction, recordMissingMonthsAction } from "./actions";
import { AssetPolicySheet } from "./asset-actions";

export const metadata = { title: "Equipment value — Books" };

const MONTH_NAME = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (key: string) => `${MONTH_NAME[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const monthDiff = (fromKey: string, toKey: string) =>
  (Number(toKey.slice(0, 4)) - Number(fromKey.slice(0, 4))) * 12 + (Number(toKey.slice(5, 7)) - Number(fromKey.slice(5, 7)));

// AR-7 (BOOKS-TAXES 1.4): the Equipment value page. Read model is the existing getBookAssets;
// totals are its sums. Enrolling, posting depreciation by hand, retiring and tax evidence moved
// to For your accountant — this page is what the equipment is worth, plus each asset's own
// life setting and the two defaults.
export default async function EquipmentValuePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  const owner = session.user.role === "OWNER";
  const data = await getBookAssets(session.user.id);
  const notice = (await searchParams).notice?.slice(0, 350);
  const field = "mt-1 w-full rounded-field border border-line bg-surface px-3 py-2";

  return (
    <div className="flex flex-col gap-6">
      <Toaster />
      <ScreenHeader
        title="What your rental equipment is worth"
        overflow={owner ? [{ kind: "form", label: "Record missing months now", action: recordMissingMonthsAction }] : undefined}
      />
      {notice ? <p role="status" className="rounded-card border border-line bg-surface p-3 text-sm">{notice}</p> : null}
      <p className="text-sm text-ink-soft">Book value is not tax value. Your CPA confirms tax classification and allowed depreciation.</p>

      <StatStrip items={[
        { label: "Cost", value: formatMoney(data.totals.costCents) },
        { label: "Worth on your books now", value: formatMoney(data.totals.worthCents) },
        { label: "Recorded through", value: data.recordedThroughMonth ? monthLabel(data.recordedThroughMonth) : "Not recorded yet" },
      ]} />

      {data.candidates.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-bold">Needs a purchase price</h2>
          {data.candidates.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-card border border-attention bg-attention-tint px-4 py-3">
              <span className="text-sm">
                <strong>{c.assetNumber}</strong> — paid {formatMoney(c.acquisitionCostCents ?? 0)}
                {c.purchaseDate ? ` on ${formatBusinessDate(c.purchaseDate)}` : ""}, not on your books yet.
              </span>
              <Link href={`/desk/inventory/${c.id}`} className="shrink-0 rounded-field border border-line bg-surface px-3 py-2 text-sm font-bold">Fix</Link>
            </div>
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-lg font-bold">On your books</h2>
        {data.assets.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing is on your books yet.</p>
        ) : data.assets.map((asset) => {
          const placedKey = businessDateKey(asset.placedInServiceOn).slice(0, 7);
          const monthsLeft = Math.max(0, asset.lifeMonths - (asset.lastDepreciationMonth ? Math.max(0, monthDiff(placedKey, asset.lastDepreciationMonth)) : 0));
          const pill = asset.disposedOn
            ? { label: `Sold ${formatBusinessDate(asset.disposedOn)}`, tone: "neutral" as const }
            : asset.retiredOn
              ? { label: `Retired ${formatBusinessDate(asset.retiredOn)}`, tone: "neutral" as const }
              : { label: "Active", tone: "good" as const };
          return (
            <div key={asset.applianceId} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold">{asset.appliance.assetNumber} · {asset.appliance.applianceType.name}</p>
                <p className="text-sm text-ink-soft">
                  Paid {formatMoney(asset.costCents)} · Worth now {formatMoney(asset.bookCarryingCents)} · {monthsLeft} months left
                </p>
              </div>
              <span className="flex items-center gap-2">
                <StatusPill label={pill.label} tone={pill.tone} />
                {!asset.retiredOn && (owner || session.user.role === "ACCOUNTANT") ? (
                  <AssetPolicySheet applianceId={asset.applianceId} version={asset.version} lifeMonths={asset.lifeMonths} salvagePercent={asset.salvagePercent} />
                ) : null}
              </span>
            </div>
          );
        })}
      </section>

      <section className="rounded-card border border-line bg-surface p-4">
        <h2 className="font-display text-lg font-bold">Book settings</h2>
        {owner ? (
          <>
            <form action={bookDefaultsAction} className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">How long appliances last on your books (months)
                <input className={field} type="number" name="months" min={1} max={360} defaultValue={data.settings?.depreciationMonthsDefault ?? 60} required />
                <span className="mt-1 block text-xs font-normal text-ink-soft">Recommended: 60 months.</span>
              </label>
              <label className="text-sm font-semibold">Value left at the end (%)
                <input className={field} type="number" name="salvagePercent" min={0} max={95} defaultValue={data.settings?.depreciationSalvagePercent ?? 0} required />
                <span className="mt-1 block text-xs font-normal text-ink-soft">Recommended: 0%.</span>
              </label>
              <p className="text-sm text-ink-soft sm:col-span-2">Applies to appliances added from now on. Appliances already on your books keep their own setting.</p>
              <button className="min-h-11 justify-self-start rounded-field bg-evergreen px-4 font-bold text-white" type="submit">Save</button>
            </form>
            <form action={bookDefaultsAction} className="mt-2">
              <input type="hidden" name="months" value="60" />
              <input type="hidden" name="salvagePercent" value="0" />
              <button className="min-h-11 rounded-field border border-line px-4 font-bold" type="submit">Restore recommended</button>
            </form>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">
            Appliances last {data.settings?.depreciationMonthsDefault ?? 60} months on your books, with {data.settings?.depreciationSalvagePercent ?? 0}% left at the end. Only the owner changes these.
          </p>
        )}
      </section>
    </div>
  );
}
