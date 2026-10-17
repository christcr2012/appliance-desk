import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { getLeadResponseDays, saveLeadResponseDays, RECOMMENDED_LEAD_RESPONSE_DAYS } from "@/domains/leads/follow-up";

export const metadata = { title: "Lead response time", robots: { index: false, follow: false } };

async function save(form: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const restore = form.get("operation") === "restore";
  const raw = form.get("days");
  const days = restore ? RECOMMENDED_LEAD_RESPONSE_DAYS : Number(typeof raw === "string" ? raw : "");
  await saveLeadResponseDays(session.user.id, days, Number(form.get("expectedDays")));
  revalidatePath("/desk/settings/lead-response");
  revalidatePath("/desk/today");
}

export default async function LeadResponseSettingsPage() {
  await requireRole("OWNER");
  const days = await getLeadResponseDays();
  return (
    <main className="mx-auto max-w-2xl space-y-5">
      <Link href="/desk/settings" className="text-sm underline">Back to settings</Link>
      <h1 className="text-xl font-semibold">Lead response time</h1>
      <p className="text-sm text-ink-soft">
        Every new lead puts a To do on your list: “Contact (name)”. This is how many days after the lead arrives that To do is due.
        Nothing is sent to the lead by this setting.
      </p>
      <form action={save} className="space-y-4 rounded-md border p-4">
        <input type="hidden" name="expectedDays" value={days} />
        <label htmlFor="days" className="block font-medium">Contact new leads within this many days</label>
        <input id="days" name="days" type="number" min={0} max={14} step={1} defaultValue={days} required className="w-full rounded-md border bg-surface p-2" />
        <p className="text-xs text-ink-soft">Currently {days === 0 ? "the same day" : `${days} ${days === 1 ? "day" : "days"}`}. The starting value is 0 (the same day), because quick replies win rentals. A larger number gives you more time but lets leads wait longer. Only the owner can change this.</p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="rounded-md border px-4 py-2 font-medium">Save</button>
          <button name="operation" value="restore" type="submit" formNoValidate className="rounded-md border px-4 py-2">Restore same-day default</button>
        </div>
      </form>
    </main>
  );
}
