import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { getRecordRetentionYears, saveRecordRetentionYears, RECOMMENDED_RETENTION_YEARS } from "@/domains/tax/retention";
import { InfoTip } from "@/components/ui/info-tip";

export const metadata = { title: "Record keeping", robots: { index: false, follow: false } };

async function saveRetention(form: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const restore = form.get("operation") === "restore";
  const raw = form.get("years");
  const years = restore ? RECOMMENDED_RETENTION_YEARS : Number(typeof raw === "string" ? raw : "");
  await saveRecordRetentionYears(session.user.id, years, Number(form.get("expectedYears")));
  revalidatePath("/desk/sales-tax/record-retention");
}

export default async function RecordRetentionPage() {
  await requireRole("OWNER");
  const years = await getRecordRetentionYears();
  return (
    <main className="mx-auto max-w-2xl space-y-5">
      <Link href="/desk/purchases" className="text-sm underline">Back to purchases</Link>
      <h2 className="text-xl font-semibold">How long to keep purchase records</h2>
      <p className="text-sm text-ink-soft">
        Owner-only setting. Receipts for appliances and parts are kept at least this long. A receipt that a filed tax
        return relies on can never be removed, whatever you choose here. Ask your CPA what period fits your situation.
      </p>
      <form action={saveRetention} className="space-y-4 rounded-md border p-4">
        <input type="hidden" name="expectedYears" value={years} />
        <label htmlFor="years" className="block font-medium">Keep records for (years) <InfoTip term="record-retention" /></label>
        <input id="years" name="years" type="number" min={1} max={50} step={1} defaultValue={years} required className="w-full rounded-md border bg-surface p-2" />
        <p className="text-xs text-ink-soft">Currently {years} {years === 1 ? "year" : "years"}. The starting value is {RECOMMENDED_RETENTION_YEARS} years.</p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="rounded-md border px-4 py-2 font-medium">Save</button>
          <button name="operation" value="restore" type="submit" formNoValidate className="rounded-md border px-4 py-2">Restore {RECOMMENDED_RETENTION_YEARS}-year default</button>
        </div>
      </form>
    </main>
  );
}
