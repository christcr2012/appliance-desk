import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { InfoTip } from "@/components/ui/info-tip";
import { getRentalEndingNoticeDays, saveRentalEndingNoticeDays, RECOMMENDED_ENDING_NOTICE_DAYS } from "@/domains/agreements/ending-notice";
import { getRentalEndReasons, saveRentalEndReasons, RECOMMENDED_END_REASONS } from "@/domains/agreements/end-reasons";

export const metadata = { title: "Rental ending reminder", robots: { index: false, follow: false } };

async function save(form: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const restore = form.get("operation") === "restore";
  const raw = form.get("days");
  const days = restore ? RECOMMENDED_ENDING_NOTICE_DAYS : Number(typeof raw === "string" ? raw : "");
  await saveRentalEndingNoticeDays(session.user.id, days, Number(form.get("expectedDays")));
  revalidatePath("/desk/settings/rental-endings");
  revalidatePath("/desk/today");
}

async function saveReasons(form: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const restore = form.get("operation") === "restore";
  const expected = JSON.parse(String(form.get("expectedReasons") ?? "[]")) as string[];
  const reasons = restore
    ? [...RECOMMENDED_END_REASONS]
    : String(form.get("reasons") ?? "").split("\n");
  await saveRentalEndReasons(session.user.id, reasons, expected);
  revalidatePath("/desk/settings/rental-endings");
}

export default async function RentalEndingsSettingsPage() {
  await requireRole("OWNER");
  const days = await getRentalEndingNoticeDays();
  const endReasons = await getRentalEndReasons();
  return (
    <main className="mx-auto max-w-2xl space-y-5">
      <Link href="/desk/settings" className="text-sm underline">Back to settings</Link>
      <h1 className="text-xl font-semibold">Rental ending reminder</h1>
      <p className="text-sm text-ink-soft">
        When a fixed-term rental is this close to its end date, a To do appears asking whether to renew it, move it to
        month-to-month, or pick up the machines. Nothing is sent to the customer and nothing is charged by this reminder.
      </p>
      <form action={save} className="space-y-4 rounded-md border p-4">
        <input type="hidden" name="expectedDays" value={days} />
        <label htmlFor="days" className="block font-medium">Remind me this many days before a rental ends <InfoTip term="rental-ending-reminder" /></label>
        <input id="days" name="days" type="number" min={1} max={365} step={1} defaultValue={days} required className="w-full rounded-md border bg-surface p-2" />
        <p className="text-xs text-ink-soft">Currently {days} {days === 1 ? "day" : "days"}. The starting value is {RECOMMENDED_ENDING_NOTICE_DAYS} days, which leaves time to talk to the customer and schedule a pickup. A larger number gives more warning but puts more rentals on your list at once. Only the owner can change this.</p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="rounded-md border px-4 py-2 font-medium">Save</button>
          <button name="operation" value="restore" type="submit" formNoValidate className="rounded-md border px-4 py-2">Restore {RECOMMENDED_ENDING_NOTICE_DAYS}-day default</button>
        </div>
      </form>
      <h2 className="text-lg font-semibold">Why rentals end</h2>
      <p className="text-sm text-ink-soft">
        When a rental ends, you can note why — one tap from this list, plus &ldquo;Other&rdquo;. It is optional, it is
        never shown to the customer, and over time it shows you why customers leave. Starting value — not confirmed:
        the common reasons a renter gives.
      </p>
      <form action={saveReasons} className="space-y-4 rounded-md border p-4">
        <input type="hidden" name="expectedReasons" value={JSON.stringify(endReasons)} />
        <label htmlFor="reasons" className="block font-medium">Reasons, one per line</label>
        <textarea id="reasons" name="reasons" rows={Math.max(4, endReasons.length)} defaultValue={endReasons.join("\n")} required className="w-full rounded-md border bg-surface p-2" />
        <p className="text-xs text-ink-soft">Keep at least one reason. Each can be up to 80 characters, and each can appear only once. Only the owner can change this.</p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="rounded-md border px-4 py-2 font-medium">Save</button>
          <button name="operation" value="restore" type="submit" formNoValidate className="rounded-md border px-4 py-2">Restore the starting list</button>
        </div>
      </form>
    </main>
  );
}
