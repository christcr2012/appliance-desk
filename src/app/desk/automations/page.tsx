import { getAutomationHealth } from "@/domains/automation/health";
import { requireRole } from "@/lib/session";
import {
  formatBusinessDate,
  formatBusinessTime,
} from "@/lib/business-date";
import {
  Button,
  Card,
  PageHeader,
  StatusPill,
} from "@/components/ui";
import type { StatusTone } from "@/components/status-badge";
import { setAutomationPausedAction } from "./actions";

export const metadata = { title: "Automations" };

const STATE_TONE: Record<string, StatusTone> = {
  healthy: "success",
  paused: "attention",
  failed: "attention",
  uncertain: "attention",
  "missing-configuration": "stopped",
  "never-run": "pending",
};

function stateLabel(state: string) {
  return state
    .replaceAll("-", " ")
    .replace(/^./, (character) => character.toUpperCase());
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
    <div className="max-w-5xl">
      <PageHeader
        title="Automation health"
        description="Each row is one durable nightly job. Success is recorded before this page calls a job healthy; missing configuration, failure, uncertainty, or an owner pause stays visible instead of being treated as success."
      />

      <div className="space-y-4">
        {health.map((item) => (
          <Card
            key={item.ruleKey}
            className="scroll-mt-4"
            title={item.label}
            description={item.explanation}
            actions={
              <StatusPill
                tone={STATE_TONE[item.state] ?? "pending"}
                label={stateLabel(item.state)}
              />
            }
          >
            <div id={item.ruleKey.replaceAll(":", "-")}>
              <p className="text-xs text-ink-faint">
                Rule: {item.ruleKey}
              </p>

              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-soft">Last success</dt>
                  <dd className="font-semibold text-ink">
                    {timestamp(item.lastSuccessAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Last failure</dt>
                  <dd className="font-semibold text-ink">
                    {item.lastFailure
                      ? timestamp(item.lastFailure.at)
                      : "None recorded"}
                  </dd>
                </div>
              </dl>

              {item.lastFailure && (
                <p className="mt-4 rounded-control border border-line bg-subtle p-3 text-sm text-ink">
                  {item.lastFailure.error}
                </p>
              )}

              {canPause && (
                <form action={setAutomationPausedAction} className="mt-4">
                  <input
                    type="hidden"
                    name="ruleKey"
                    value={item.ruleKey}
                  />
                  <input
                    type="hidden"
                    name="paused"
                    value={item.state === "paused" ? "false" : "true"}
                  />
                  <Button type="submit" variant="secondary">
                    {item.state === "paused"
                      ? "Resume this automation"
                      : "Pause this automation"}
                  </Button>
                </form>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
