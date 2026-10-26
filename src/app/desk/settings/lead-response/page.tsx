import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { getLeadResponseDays, saveLeadResponseDays, RECOMMENDED_LEAD_RESPONSE_DAYS } from "@/domains/leads/follow-up";
import { getLeadAssignment, saveLeadAssignment, type LeadAssignmentMode } from "@/domains/leads/assignment";

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

async function saveAssignment(form: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const restore = form.get("operation") === "restore";
  const mode = (restore ? "OWNER" : form.get("mode")) as LeadAssignmentMode;
  const personId = restore ? null : (typeof form.get("personId") === "string" && form.get("personId") ? String(form.get("personId")) : null);
  const expectedMode = String(form.get("expectedMode") ?? "OWNER") as LeadAssignmentMode;
  const expectedPersonId = typeof form.get("expectedPersonId") === "string" && form.get("expectedPersonId") ? String(form.get("expectedPersonId")) : null;
  await saveLeadAssignment(session.user.id, { mode, personId }, { mode: expectedMode, personId: expectedPersonId });
  revalidatePath("/desk/settings/lead-response");
  revalidatePath("/desk/leads");
}

export default async function LeadResponseSettingsPage() {
  await requireRole("OWNER");
  const days = await getLeadResponseDays();
  const assignment = await getLeadAssignment();
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
      <form action={saveAssignment} className="space-y-4 rounded-md border p-4">
        <input type="hidden" name="expectedMode" value={assignment.mode} />
        <input type="hidden" name="expectedPersonId" value={assignment.personId ?? ""} />
        <fieldset>
          <legend className="block font-medium">New leads go to</legend>
          <p className="text-xs text-ink-soft">Who owns a lead the moment it arrives. Only you can change this.</p>
          <div className="mt-3 space-y-2">
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" value="OWNER" defaultChecked={assignment.mode === "OWNER"} className="mt-1" />
              <span><span className="font-medium">Me</span><span className="block text-sm text-ink-soft">You get every new lead.</span></span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" value="PERSON" defaultChecked={assignment.mode === "PERSON"} className="mt-1" />
              <span><span className="font-medium">One person</span><span className="block text-sm text-ink-soft">Every new lead goes to the same person.</span></span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" value="ROTATE" defaultChecked={assignment.mode === "ROTATE"} className="mt-1" />
              <span><span className="font-medium">Take turns</span><span className="block text-sm text-ink-soft">Each new lead goes to the next person, in order.</span></span>
            </label>
          </div>
        </fieldset>
        <div>
          <label htmlFor="personId" className="block font-medium">Person new leads go to</label>
          <select id="personId" name="personId" defaultValue={assignment.personId ?? ""} className="w-full rounded-md border bg-surface p-2">
            <option value="">Choose a person…</option>
            {assignment.people.map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
          <p className="text-xs text-ink-soft">Only used when “One person” is chosen above. If that person can no longer be given leads, new leads go to you instead. The starting value is “Me”, because a new business has one person selling.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="rounded-md border px-4 py-2 font-medium">Save</button>
          <button name="operation" value="restore" type="submit" formNoValidate className="rounded-md border px-4 py-2">Restore “Me”</button>
        </div>
      </form>
    </main>
  );
}
