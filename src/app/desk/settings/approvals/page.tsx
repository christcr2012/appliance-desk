import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { APPROVAL_KINDS, APPROVAL_KIND_KEYS, ApprovalInputError, getApprovalLimits, saveApprovalLimits } from "@/domains/approvals";
import { formatMoney, moneyInputValue } from "@/lib/money-ui";
import { SuggestButton } from "./suggest-button";

export const metadata = { title: "Approval limits", robots: { index: false, follow: false } };

function cents(raw: FormDataEntryValue | null): number | null {
  const text = typeof raw === "string" ? raw.trim().replace(/^\$/, "") : "";
  if (!text) return null;
  if (!/^[0-9]{1,8}(\.[0-9]{1,2})?$/.test(text)) throw new ApprovalInputError("Enter a limit in dollars, like 50 or 50.00, or leave it blank.");
  const [whole, frac = ""] = text.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

async function save(form: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const restore = form.get("operation") === "restore";
  try {
    await saveApprovalLimits(session.user.id, {
      limitsCents: restore ? {} : { WRITE_OFF: cents(form.get("WRITE_OFF")), EXPENSE: cents(form.get("EXPENSE")) },
      expiryDays: restore ? 7 : Number(form.get("expiryDays")),
    });
  } catch (e) {
    if (!(e instanceof ApprovalInputError)) throw e;
  }
  revalidatePath("/desk/settings/approvals");
  revalidatePath("/desk/approvals");
}

export default async function ApprovalLimitsPage() {
  await requireRole("OWNER");
  const limits = await getApprovalLimits();
  return (
    <main className="mx-auto max-w-2xl space-y-5">
      <Link href="/desk/settings" className="text-sm underline">Back to settings</Link>
      <h1 className="text-xl font-semibold">Approval limits</h1>
      <p className="text-sm text-ink-soft">
        Set a dollar amount for each kind of action. When an admin starts one at or above it, it waits for your yes or no on the{" "}
        <Link href="/desk/approvals" className="underline">Approvals</Link> page instead of happening. Leave a box blank for no limit.
        Your own actions never need approval. Everything starts blank, so nothing changes until you fill one in.
        Refunds, credits and deposit decisions are not covered yet.
      </p>
      <form action={save} className="space-y-5 rounded-md border p-4">
        {APPROVAL_KIND_KEYS.map((k) => (
          <div key={k} className="space-y-1">
            <label htmlFor={k} className="block font-medium">{APPROVAL_KINDS[k].label}: ask me at or above (dollars)</label>
            <div className="flex flex-wrap items-center gap-2">
              <input id={k} name={k} inputMode="decimal" defaultValue={limits.thresholds[k] !== undefined ? moneyInputValue(limits.thresholds[k]!) : ""} placeholder="No limit" className="w-40 rounded-md border bg-surface p-2" />
              <SuggestButton targetId={k} cents={APPROVAL_KINDS[k].suggestedCents} label={`Fill in ${formatMoney(APPROVAL_KINDS[k].suggestedCents)}`} />
            </div>
            <p className="text-xs text-ink-soft">Suggested starting point: {formatMoney(APPROVAL_KINDS[k].suggestedCents)}. The button only fills in the box; nothing is saved until you press Save.</p>
          </div>
        ))}
        <div className="space-y-1">
          <label htmlFor="expiryDays" className="block font-medium">A request expires after (days)</label>
          <input id="expiryDays" name="expiryDays" type="number" min={1} max={30} step={1} defaultValue={limits.expiryDays} required className="w-24 rounded-md border bg-surface p-2" />
          <p className="text-xs text-ink-soft">An expired request cannot be approved; the admin has to ask again. Starting value 7.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="min-h-11 rounded-md border px-4 py-2 font-medium">Save</button>
          <button name="operation" value="restore" type="submit" formNoValidate className="min-h-11 rounded-md border px-4 py-2">Turn all limits off (recommended starting point)</button>
        </div>
      </form>
    </main>
  );
}
