import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { getUnsignedFollowUpDays, saveUnsignedFollowUpDays, RECOMMENDED_UNSIGNED_FOLLOW_UP_DAYS } from "@/domains/agreements/unsigned-follow-up";

export const metadata = { title: "Unsigned agreement reminder", robots: { index: false, follow: false } };

async function save(form: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const restore = form.get("operation") === "restore";
  const raw = form.get("days");
  const days = restore ? RECOMMENDED_UNSIGNED_FOLLOW_UP_DAYS : Number(typeof raw === "string" ? raw : "");
  await saveUnsignedFollowUpDays(session.user.id, days, Number(form.get("expectedDays")));
  revalidatePath("/desk/settings/unsigned-follow-up");
  revalidatePath("/desk/today");
}

export default async function UnsignedFollowUpSettingsPage() {
  await requireRole("OWNER");
  const days = await getUnsignedFollowUpDays();
  return (
    <main className="mx-auto max-w-2xl space-y-5">
      <Link href="/desk/settings" className="text-sm underline">Back to settings</Link>
      <h1 className="text-xl font-semibold">Unsigned agreement reminder</h1>
      <p className="text-sm text-ink-soft">
        When an agreement has been sent to a customer and they have not signed it, a To do appears: “Follow up: (name) hasn&apos;t signed”.
        This is how many days it waits before that To do appears. It goes away on its own once they sign or you cancel the agreement. Nothing is sent to the customer by this setting.
      </p>
      <form action={save} className="space-y-4 rounded-md border p-4">
        <input type="hidden" name="expectedDays" value={days} />
        <label htmlFor="days" className="block font-medium">Remind me after this many days without a signature</label>
        <input id="days" name="days" type="number" min={1} max={30} step={1} defaultValue={days} required className="w-full rounded-md border bg-surface p-2" />
        <p className="text-xs text-ink-soft">Currently {days} {days === 1 ? "day" : "days"}. The starting value is {RECOMMENDED_UNSIGNED_FOLLOW_UP_DAYS} days: long enough not to nag someone who is still reading it, short enough that a rental does not stall. A smaller number reminds you sooner. Only the owner can change this.</p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="rounded-md border px-4 py-2 font-medium">Save</button>
          <button name="operation" value="restore" type="submit" formNoValidate className="rounded-md border px-4 py-2">Restore the recommended {RECOMMENDED_UNSIGNED_FOLLOW_UP_DAYS} days</button>
        </div>
      </form>
    </main>
  );
}
