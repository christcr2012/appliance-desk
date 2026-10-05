import { getAutomationHealth } from "@/domains/automation/health";
import { requireRole } from "@/lib/session";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { setAutomationPausedAction } from "./actions";

export const metadata = { title: "Automations" };

function stateLabel(state: string) {
  return state.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase());
}

function timestamp(value: Date | null) {
  if (!value) return "Never";
  return `${formatBusinessDate(value)} at ${formatBusinessTime(value)}`;
}

export default async function AutomationsPage() {
  const session = await requireRole("OWNER", "ADMIN");
  const health = await getAutomationHealth();
  const canPause = session.user.role === "OWNER";

  return (
    <main className="max-w-5xl">
      <h1 className="text-xl font-semibold text-ink">Automation health</h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-soft">
        Each row is one durable nightly job. A successful run is recorded before this page calls it healthy; a missing
        configuration, failed run, uncertain run or owner pause stays visible instead of being treated as success.
      </p>

      <div className="mt-6 space-y-4">
        {health.map((item) => (
          <section id={item.ruleKey.replaceAll(":", "-")} key={item.ruleKey} className="rounded-xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="font-medium text-ink">{item.label}</h2>
                <p className="mt-1 text-sm text-ink-soft">{item.explanation}</p>
                <p className="mt-2 text-xs text-ink-faint">Rule: {item.ruleKey}</p>
              </div>
              <span className="rounded-full border border-control bg-subtle px-3 py-1 text-xs font-medium text-ink">
                {stateLabel(item.state)}
              </span>
            </div>

            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-soft">Last success</dt>
                <dd className="font-medium text-ink">{timestamp(item.lastSuccessAt)}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">Last failure</dt>
                <dd className="font-medium text-ink">
                  {item.lastFailure ? timestamp(item.lastFailure.at) : "None recorded"}
                </dd>
              </div>
            </dl>

            {item.lastFailure && (
              <p className="mt-3 rounded-lg border border-line bg-subtle p-3 text-sm text-ink">
                {item.lastFailure.error}
              </p>
            )}

            {canPause && (
              <form action={setAutomationPausedAction} className="mt-4">
                <input type="hidden" name="ruleKey" value={item.ruleKey} />
                <input type="hidden" name="paused" value={item.state === "paused" ? "false" : "true"} />
                <button type="submit" className="min-h-11 rounded-lg border border-control px-4 py-2 text-sm font-medium text-primary hover:bg-subtle">
                  {item.state === "paused" ? "Resume this automation" : "Pause this automation"}
                </button>
              </form>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
