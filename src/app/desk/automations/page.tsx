import { getAutomationHealth } from "@/domains/automation/health";
import { requireRole } from "@/lib/session";
import { listSystemIssues } from "@/domains/system-issues/queries";
import { SystemIssuesSection } from "./system-issues-section";
import { listOpsAgentKeys } from "@/domains/system-issues/ops-auth";
import { OpsKeyPanel } from "./ops-key-panel";
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

export const metadata = { title: "System health" };

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

export default async function AutomationsPage({ searchParams }: { searchParams?: Promise<{ issuesCursor?: string }> } = {}) {
  const session = await requireRole("OWNER", "ADMIN");
  const cursor = (await searchParams)?.issuesCursor;
  const [health, issueList] = await Promise.all([getAutomationHealth(), listSystemIssues(session.user.id, { limit: 25, cursor })]);
  const canPause = session.user.role === "OWNER";
  const keys = canPause ? await listOpsAgentKeys(session.user.id) : [];

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="System health"
        description="Each row is one durable nightly job. Success is recorded before this page calls a job healthy; missing configuration, failure, uncertainty, or an owner pause stays visible instead of being treated as success."
      />

      <SystemIssuesSection issues={issueList.rows} nextCursor={issueList.nextCursor} canManage={canPause} />
      {canPause ? <OpsKeyPanel keys={keys.map(key => ({
        id: key.id, label: key.label, createdAt: timestamp(key.createdAt),
        lastUsedAt: key.lastUsedAt ? timestamp(key.lastUsedAt) : null,
        revokedAt: key.revokedAt ? timestamp(key.revokedAt) : null,
      }))} /> : <p className="text-sm text-ink-soft">AI check-up keys are managed by the owner.</p>}
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
