import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  RECOMMENDED_FEEDBACK_MAX_ATTACHMENTS, RECOMMENDED_FEEDBACK_REOPEN_DAYS, getFeedbackSettings, saveFeedbackSettings,
} from "@/domains/feedback/settings";

export const metadata = { title: "App feedback settings", robots: { index: false, follow: false } };

async function save(form: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const restore = form.get("operation") === "restore";
  const next = restore
    ? { maxAttachments: RECOMMENDED_FEEDBACK_MAX_ATTACHMENTS, reopenDays: RECOMMENDED_FEEDBACK_REOPEN_DAYS }
    : { maxAttachments: Number(form.get("maxAttachments")), reopenDays: Number(form.get("reopenDays")) };
  const expected = { maxAttachments: Number(form.get("expectedMax")), reopenDays: Number(form.get("expectedDays")) };
  await saveFeedbackSettings(session.user.id, next, expected);
  revalidatePath("/desk/settings/feedback");
}

// MCP-10a: Settings › App feedback. Owner only; changes apply to reports from now on.
export default async function FeedbackSettingsPage() {
  await requireRole("OWNER");
  const settings = await getFeedbackSettings();
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/desk/settings" className="text-sm underline">Back to settings</Link>
      <h1 className="text-xl font-semibold">App feedback</h1>
      <p className="text-sm text-ink-soft">
        Customers and your team can tell you about problems with this app or suggest ideas. These two settings shape that
        form. Nothing here sends anyone a message.
      </p>
      <p className="text-sm text-ink">
        Starting value — not confirmed. Both numbers below are our best starting guess; they are on your Decisions list
        (DQ-MCP10A-1 and DQ-MCP10A-2) to confirm or change.
      </p>
      <form action={save} className="space-y-4 rounded-md border p-4">
        <input type="hidden" name="expectedMax" value={settings.maxAttachments} />
        <input type="hidden" name="expectedDays" value={settings.reopenDays} />
        <label htmlFor="maxAttachments" className="block font-medium">Pictures allowed per report</label>
        <input id="maxAttachments" name="maxAttachments" type="number" min={0} max={3} step={1} defaultValue={settings.maxAttachments} required className="w-full rounded-md border bg-surface p-2" />
        <p className="text-xs text-ink-soft">
          Currently {settings.maxAttachments}. The starting value is {RECOMMENDED_FEEDBACK_MAX_ATTACHMENTS}: enough for a
          few screenshots of one problem. 0 turns pictures off. 3 is the most, so private storage stays small.
        </p>
        <label htmlFor="reopenDays" className="block font-medium">Days a finished report can be reopened</label>
        <input id="reopenDays" name="reopenDays" type="number" min={1} max={365} step={1} defaultValue={settings.reopenDays} required className="w-full rounded-md border bg-surface p-2" />
        <p className="text-xs text-ink-soft">
          Currently {settings.reopenDays} days. The starting value is {RECOMMENDED_FEEDBACK_REOPEN_DAYS} days (about one
          season), long enough to notice that a fix didn&apos;t hold. After that, the person sends a new report. Only
          the owner can change these.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="rounded-md border px-4 py-2 font-medium">Save</button>
          <button name="operation" value="restore" type="submit" formNoValidate className="rounded-md border px-4 py-2">Restore recommended</button>
        </div>
      </form>
    </div>
  );
}
