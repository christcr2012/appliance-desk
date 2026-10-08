import Link from "next/link";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { assertActiveTeamActor } from "@/lib/team-actor";

export const metadata = { title: "Consumer use-tax threshold", robots: { index: false, follow: false } };

async function saveUseTaxThreshold(form: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const raw = form.get("thresholdCents");
  const oldRaw = form.get("expectedCents");
  const reset = form.get("operation") === "restore";
  const next = reset ? 30000 : Number(raw);
  const old = Number(oldRaw);
  if (!Number.isSafeInteger(next) || next < 0 || next > 100000000 ||
      !Number.isSafeInteger(old) || old < 0) {
    throw new Error("Enter a valid threshold in cents.");
  }
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, session.user.id, ["OWNER"]);
    const changed = await tx.businessSettings.updateMany({
      where: { id: "singleton", useTaxMonthlyThresholdCents: old },
      data: { useTaxMonthlyThresholdCents: next },
    });
    if (changed.count !== 1) {
      throw new Error("The threshold was updated in another session. Refresh before saving.");
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "tax.use_tax_threshold.update",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: { useTaxMonthlyThresholdCents: old },
        newValue: { useTaxMonthlyThresholdCents: next },
      },
    });
  });
  revalidatePath("/desk/tax/use-tax-settings");
}

export default async function UseTaxThresholdPage() {
  await requireRole("OWNER");
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { useTaxMonthlyThresholdCents: true },
  });
  const cents = settings?.useTaxMonthlyThresholdCents ?? 30000;
  return (
    <main className="mx-auto max-w-2xl space-y-5">
      <Link href="/desk/inventory" className="text-sm underline">Back to inventory</Link>
      <h1 className="text-xl font-semibold">Consumer use-tax reporting threshold</h1>
      <p className="text-sm text-ink-soft">
        Owner-only setting. The annual-to-monthly decision uses cumulative yearly
        use tax due, not the purchase value. Changes apply prospectively; filed
        periods must never be rewritten. Confirm your filing requirements with your tax adviser.
      </p>
      <form action={saveUseTaxThreshold} className="space-y-4 rounded-md border p-4">
        <input type="hidden" name="expectedCents" value={cents} />
        <label htmlFor="thresholdCents" className="block font-medium">
          Annual use tax due threshold (cents)
        </label>
        <input id="thresholdCents" name="thresholdCents" type="number" step="1" min="0"
          max="100000000" defaultValue={cents} required
          className="w-full rounded-md border bg-surface p-2" />
        <p className="text-xs text-ink-soft">
          {cents} cents is ${(cents / 100).toFixed(2)}. The initial default is $300.
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
      <Link href="/desk/tax/use-tax-worksheets" className="underline">
        View private use-tax worksheets
      </Link>
    </main>
  );
}
