import type { AutomationHealthRow } from "@/domains/automation/health";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { MONITOR_ACTIONS, type listMonitorRules, type listMonitorConnections } from "@/domains/agent-control/monitoring";
import { Button } from "@/components/ui";
import { saveMonitorRuleAction } from "./actions";

type MonitorRows = Awaited<ReturnType<typeof listMonitorRules>>;
type Props = { rules: MonitorRows; connections: Awaited<ReturnType<typeof listMonitorConnections>>;
  heartbeat: AutomationHealthRow | null; canManage: boolean };

export function MonitoringSection({ rules, connections, heartbeat, canManage }: Props) {
  return (
    <section id="monitoring" aria-labelledby="monitoring-heading" className="my-8 space-y-4 scroll-mt-4">
      <div>
        <h2 id="monitoring-heading" className="text-xl font-semibold text-ink">Monitoring</h2>
        <p className="mt-1 text-sm text-ink-soft">These checks use the existing daily System health sweep.
          They start turned off. An alert becomes one system problem on your To do list,
          not a new task each day.</p>
        <p className="mt-1 text-sm text-ink-soft">Email notices are off until you turn them on
          and the app&apos;s email controls permit sending. Assistant actions require a separate owner-approved rule and connection.</p>
      </div>
      <div className="rounded-control border border-line bg-surface p-4">
        <h3 className="font-semibold text-ink">Monitoring heartbeat</h3>
        <p className="mt-1 text-sm text-ink-soft">Last successful sweep: {heartbeat?.lastSuccessAt
          ? formatBusinessDate(heartbeat.lastSuccessAt) + " at " + formatBusinessTime(heartbeat.lastSuccessAt)
          : "Never recorded"}.</p>
        <p className="text-sm text-ink-soft">Next expected: {heartbeat?.nextDueAt
          ? formatBusinessDate(heartbeat.nextDueAt) + " at " + formatBusinessTime(heartbeat.nextDueAt)
          : "Not scheduled"}. State: {heartbeat?.state ?? "Unknown"}.</p>
        <p className="mt-1 text-xs text-ink-soft">A whole-app outage cannot be detected from inside this app.
          An external uptime checker can monitor /api/health without signing in; it reports only that the app responds.</p>
      </div>
      {rules.filter((rule) => rule.configurable).map((rule) => (
        <div key={rule.key} className="rounded-control border border-line bg-surface p-4">
          <h3 className="font-semibold text-ink">{rule.label}</h3>
          <p className="text-xs text-ink-soft">Recommended starting values: off; alert after two failures;
            don&apos;t repeat for 24 hours; email off. Each rule checks the app&apos;s own records.</p>
          {canManage ? (
            <form action={saveMonitorRuleAction} className="mt-3 space-y-3">
              <input type="hidden" name="key" value={rule.key} />
              <input type="hidden" name="version" value={rule.version ?? ""} />
              <label className="flex gap-2 text-sm text-ink">
                <input type="checkbox" name="enabled" defaultChecked={rule.enabled} /> Turn this check on
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-sm text-ink">Alert after failed checks in a row
                  <input type="number" name="failuresBeforeAlert" min={1} max={10} step={1}
                    defaultValue={rule.failuresBeforeAlert} required
                    className="mt-1 block w-full rounded-control border border-line-strong bg-surface p-2" />
                </label>
                <label className="text-sm text-ink">Don&apos;t repeat for this many hours
                  <input type="number" name="cooldownHours" min={1} max={168} step={1}
                    defaultValue={rule.cooldownHours} required
                    className="mt-1 block w-full rounded-control border border-line-strong bg-surface p-2" />
                </label>
              </div>
              <label className="flex gap-2 text-sm text-ink">
                <input type="checkbox" name="notifyEmail" defaultChecked={rule.notifyEmail} /> Also email owners
                (only when email sending is allowed)
              </label>
              <fieldset className="rounded-control border border-line p-3">
                <legend className="px-1 text-sm font-semibold">Optional standing assistant approval</legend>
                <p className="mb-2 text-xs text-ink-soft">Choose one specific maintenance action and one of your active assistant
                  connections. Once this check alerts, the app may perform that action automatically without asking you again.
                  Turning off this rule, changing it, or revoking the connection stops pending actions. Starting value: none.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-sm text-ink">Approved action
                    <select name="autoAction" defaultValue={rule.autoAction ?? ""} className="mt-1 block w-full rounded-control border border-line-strong bg-surface p-2">
                      <option value="">No automatic action</option>
                      {MONITOR_ACTIONS.map(action => <option key={action.value} value={action.value}>{action.label}</option>)}
                    </select>
                  </label>
                  <label className="text-sm text-ink">Approved connection
                    <select name="autoActionConnectionId" defaultValue={rule.autoActionConnectionId ?? ""}
                      className="mt-1 block w-full rounded-control border border-line-strong bg-surface p-2">
                      <option value="">No assistant connection</option>
                      {connections.map(connection => <option key={connection.id} value={connection.id}>{connection.label}</option>)}
                    </select>
                  </label>
                </div>
                {!connections.length ? <p className="mt-2 text-xs text-ink-soft">Connect an assistant with maintenance access
                  before enabling an automatic action.</p> : null}
              </fieldset>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" variant="secondary">Save monitoring</Button>
                <Button type="submit" name="operation" value="restore" formNoValidate variant="secondary">
                  Restore recommended
                </Button>
              </div>
            </form>
          ) : <p className="mt-2 text-sm text-ink-soft">This check is {rule.enabled ? "on" : "off"}.
            Only the owner can change it.</p>}
        </div>
      ))}
    </section>
  );
}
