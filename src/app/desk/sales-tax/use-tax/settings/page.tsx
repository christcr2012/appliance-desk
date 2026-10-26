import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { parseDollarInput } from "@/lib/money-ui";
import { MoneyInput, Money } from "@/components/ui/money";
import { InfoTip } from "@/components/ui/info-tip";
import { getUseTaxThreshold, saveUseTaxThreshold as saveUseTaxThresholdRule } from "@/domains/tax/use-tax";

export const metadata = { title: "Consumer use-tax threshold", robots: { index: false, follow: false } };

async function saveUseTaxThreshold(form: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const raw = form.get("thresholdDollars");
  const oldRaw = form.get("expectedCents");
  const reset = form.get("operation") === "restore";
  const next = reset ? 30000 : parseDollarInput(typeof raw === "string" ? raw : "", 100000000);
  const old = Number(oldRaw);
  if (!Number.isSafeInteger(next) || next < 0 || next > 100000000 ||
      !Number.isSafeInteger(old) || old < 0) {
    throw new Error("Enter a valid threshold in dollars.");
  }
  await saveUseTaxThresholdRule(session.user.id, next, old);
  revalidatePath("/desk/sales-tax/use-tax/settings");
}

export default async function UseTaxThresholdPage() {
  await requireRole("OWNER");
  const cents = await getUseTaxThreshold();
  return (
    <main className="mx-auto max-w-2xl space-y-5">
      <Link href="/desk/inventory" className="text-sm underline">Back to inventory</Link>
      <h2 className="text-xl font-semibold">Use-tax threshold</h2>
      <p className="text-sm text-ink-soft">
        Owner-only setting. The annual-to-monthly decision uses cumulative yearly
        use tax due, not the purchase value. Changes apply prospectively; filed
        periods must never be rewritten. Confirm your filing requirements with your tax adviser.
      </p>
      <form action={saveUseTaxThreshold} className="space-y-4 rounded-md border p-4">
        <input type="hidden" name="expectedCents" value={cents} />
        <label htmlFor="thresholdDollars" className="block font-medium">
          Annual use tax due threshold ($) <InfoTip term="use-tax-threshold" />
        </label>
        <MoneyInput id="thresholdDollars" name="thresholdDollars" cents={cents}
          className="w-full rounded-md border bg-surface p-2" />
        <p id="thresholdDollars-help" className="text-xs text-ink-soft">
          Current threshold: <Money cents={cents} />. The initial default is $300.00.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="rounded-md border px-4 py-2 font-medium">
            Save threshold
          </button>
          <button name="operation" value="restore" type="submit"
            formNoValidate className="rounded-md border px-4 py-2">
            Restore $300 default
          </button>
        </div>
      </form>
      <Link href="/desk/sales-tax/use-tax" className="underline">
        View private use-tax worksheets
      </Link>
    </main>
  );
}
