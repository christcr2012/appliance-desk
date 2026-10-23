import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { parseDollarInput, formatMoney, moneyInputValue } from "@/lib/money-ui";
import { businessDateKey } from "@/lib/business-date";
import { CapabilityError } from "@/domains/capabilities";
import {
  clearMonthlyGoal, getAlertSettings, getGoalProgress, GoalError, setAlertSettings, setMonthlyGoal,
  DEFAULT_IDLE_ALERT_DAYS, type GoalMetric,
} from "@/domains/goals";

export const metadata = { title: "Goals and alerts", robots: { index: false, follow: false } };

const PAGE = "/desk/settings/goals";

function fail(message: string): never {
  redirect(`${PAGE}?error=${encodeURIComponent(message)}`);
}

async function saveGoal(form: FormData) {
  "use server";
  const session = await requireRole("OWNER", "ADMIN");
  const metric = String(form.get("metric") ?? "") as GoalMetric;
  try {
    if (form.get("operation") === "clear") {
      await clearMonthlyGoal(session.user.id, metric);
    } else {
      const raw = String(form.get("target") ?? "").trim();
      const target = metric === "cash" ? parseDollarInput(raw) : /^[0-9]{1,6}$/.test(raw) ? Number(raw) : NaN;
      await setMonthlyGoal(session.user.id, metric, target);
    }
  } catch (e) {
    if (e instanceof GoalError || e instanceof CapabilityError) fail(e.message);
    if (e instanceof Error && /dollars|amount|Enter/i.test(e.message)) fail("Enter the target as a plain number, like 5000 or 12.");
    throw e;
  }
  revalidatePath(PAGE);
  revalidatePath("/desk/today");
  redirect(`${PAGE}?saved=1`);
}

async function saveAlerts(form: FormData) {
  "use server";
  const session = await requireRole("OWNER", "ADMIN");
  const restore = form.get("operation") === "restore";
  const pctRaw = String(form.get("utilizationPercent") ?? "").trim();
  try {
    await setAlertSettings(session.user.id, {
      idleDays: restore ? DEFAULT_IDLE_ALERT_DAYS : Number(form.get("idleDays")),
      utilizationPercent: restore || pctRaw === "" ? null : Number(pctRaw),
    });
  } catch (e) {
    if (e instanceof GoalError || e instanceof CapabilityError) fail(e.message);
    throw e;
  }
  revalidatePath(PAGE);
  revalidatePath("/desk/today");
  redirect(`${PAGE}?saved=1`);
}

const STATUS_TEXT = {
  MET: "Goal reached.",
  ON_PACE: "On pace.",
  BEHIND: "Behind pace.",
  TOO_EARLY: "Too early in the month to tell.",
} as const;

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const params = await searchParams;
  const now = new Date();
  const [progress, alerts] = await Promise.all([getGoalProgress(now), getAlertSettings()]);
  const monthKey = businessDateKey(now).slice(0, 7);
  const show = (metric: GoalMetric, n: number) => (metric === "cash" ? formatMoney(n) : String(n));
  return (
    <main className="mx-auto max-w-2xl space-y-5">
      <Link href="/desk/settings" className="text-sm underline">Back to settings</Link>
      <h1 className="text-xl font-semibold">Goals and alerts</h1>
      <p className="text-sm text-ink-soft">
        Pick a target for this month ({monthKey}) and the desk will show how you are doing and put a note on your Today list if you fall behind.
        Targets are for one month only; set next month&apos;s on the 1st. Nothing here changes any money or any customer.
      </p>
      {params.error && <p role="alert" className="rounded-md border border-red-600 p-3 text-sm">{params.error}</p>}
      {params.saved && <p role="status" className="rounded-md border p-3 text-sm">Saved.</p>}

      {progress.map((g) => (
        <form key={g.metric} action={saveGoal} className="space-y-2 rounded-md border p-4">
          <input type="hidden" name="metric" value={g.metric} />
          <h2 className="font-medium">{g.label}</h2>
          <p className="text-sm">
            So far this month: <strong>{show(g.metric, g.actual)}</strong>
            {g.target !== null && g.pace && (
              <> of {show(g.metric, g.target)} ({g.pace.percentOfTarget}%). {STATUS_TEXT[g.pace.status]}
                {g.pace.status !== "MET" && g.pace.status !== "TOO_EARLY" && <> A steady pace would be about {show(g.metric, g.pace.expectedSoFar)} by today.</>}
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`t-${g.metric}`} className="font-medium">{g.metric === "cash" ? "Target (dollars)" : "Target (number of rentals)"}</label>
            <input
              id={`t-${g.metric}`} name="target" inputMode={g.metric === "cash" ? "decimal" : "numeric"} required
              defaultValue={g.target !== null ? (g.metric === "cash" ? moneyInputValue(g.target) : String(g.target)) : ""}
              className="w-36 rounded-md border bg-surface p-2"
            />
            <button type="submit" className="min-h-11 rounded-md border px-4 py-2 font-medium">Save target</button>
            {g.target !== null && <button name="operation" value="clear" type="submit" formNoValidate className="min-h-11 rounded-md border px-4 py-2">Remove target</button>}
          </div>
          <p className="text-xs text-ink-soft">{g.metric === "cash" ? "Counts payments by the day you received them." : "Counts rentals by their start date."}</p>
        </form>
      ))}

      <form action={saveAlerts} className="space-y-4 rounded-md border p-4">
        <h2 className="font-medium">Warnings on your Today list</h2>
        <div className="space-y-1">
          <label htmlFor="idleDays" className="block font-medium">Warn me when an appliance has sat idle for (days)</label>
          <input id="idleDays" name="idleDays" type="number" min={0} max={365} step={1} required defaultValue={alerts.idleDays} className="w-24 rounded-md border bg-surface p-2" />
          <p className="text-xs text-ink-soft">Counts ready-to-rent appliances that no customer has had for that long, as one note, not one per appliance. Starting value {DEFAULT_IDLE_ALERT_DAYS}. Enter 0 to turn it off.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="utilizationPercent" className="block font-medium">Warn me when less than this percent of appliance time was rented (last 30 days)</label>
          <input id="utilizationPercent" name="utilizationPercent" type="number" min={1} max={99} step={1} defaultValue={alerts.utilizationPercent ?? ""} placeholder="Off" className="w-24 rounded-md border bg-surface p-2" />
          <p className="text-xs text-ink-soft">Starts off. A good first try is 40. It stays quiet until the appliances have been in your fleet long enough to judge.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="min-h-11 rounded-md border px-4 py-2 font-medium">Save warnings</button>
          <button name="operation" value="restore" type="submit" formNoValidate className="min-h-11 rounded-md border px-4 py-2">Restore recommended (idle {DEFAULT_IDLE_ALERT_DAYS} days, utilization off)</button>
        </div>
      </form>
      <p className="text-xs text-ink-soft">Owners and admins who are allowed to change business settings can use this page.</p>
    </main>
  );
}
