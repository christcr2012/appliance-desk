import { getAutomationHealth, LATE_GRACE_MAX, LATE_GRACE_MIN, RECOMMENDED_LATE_GRACE_MINUTES } from "@/domains/automation/health";
import { requireRole } from "@/lib/session";
import { listSystemIssues } from "@/domains/system-issues/queries";
import { SystemIssuesSection } from "./system-issues-section";
import { listOpsAgentKeys } from "@/domains/system-issues/ops-auth";
import { OpsKeyPanel } from "./ops-key-panel";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { Button, PageHeader } from "@/components/ui";
import { saveLateGraceAction, setAutomationPausedAction, saveBackupRetentionAction, retryBackupAction } from "./actions";
import { getBackupDashboard } from "@/domains/backup/dashboard";
import { HealthLegend, HealthRow } from "./health-row";

export const metadata = { title: "System health" };

function timestamp(value: Date | null) {
  if (!value) return "Never";
  return `${formatBusinessDate(value)} at ${formatBusinessTime(value)}`;
}

function hoursAndMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 0 ? "" : `${h} hour${h === 1 ? "" : "s"}`;
  const mins = m === 0 ? "" : `${m} minute${m === 1 ? "" : "s"}`;
  return [hours, mins].filter(Boolean).join(" ") || "0 minutes";
}

export default async function AutomationsPage({ searchParams }: { searchParams?: Promise<{ issuesCursor?: string; backupMessage?: string }> } = {}) {
  const session = await requireRole("OWNER", "ADMIN");
  const cursor = (await searchParams)?.issuesCursor;
  const [health, issueList, backup] = await Promise.all([getAutomationHealth(), listSystemIssues(session.user.id, { limit: 25, cursor }), getBackupDashboard()]);
  const canPause = session.user.role === "OWNER";
  const keys = canPause ? await listOpsAgentKeys(session.user.id) : [];
  const grace = health[0]?.graceMinutes ?? RECOMMENDED_LATE_GRACE_MINUTES;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="System health"
        description="Each row is one nightly job. A job only shows Working after it finished on time; late, failed, unsure, paused and missing setup stay visible."
      />

      <SystemIssuesSection issues={issueList.rows} nextCursor={issueList.nextCursor} canManage={canPause} />
      {canPause ? <OpsKeyPanel keys={keys.map(key => ({
        id: key.id, label: key.label, createdAt: timestamp(key.createdAt),
        lastUsedAt: key.lastUsedAt ? timestamp(key.lastUsedAt) : null,
        revokedAt: key.revokedAt ? timestamp(key.revokedAt) : null,
      }))} /> : <p className="text-sm text-ink-soft">AI check-up keys are managed by the owner.</p>}

      <section id="backup-settings" aria-labelledby="backup-settings-heading" className="mb-6 rounded-card border border-line bg-surface p-4">
        <h2 id="backup-settings-heading" className="text-base font-bold text-ink">Backup and recovery</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Backup destination: {backup.destination}. Private photo storage: {backup.privatePhotos === "READY"
            ? "Connected" : "Needs attention (" + backup.privatePhotos.toLowerCase().replaceAll("_", " ") + ")" }.
          {backup.destination === "not set up" ? " Connect a private backup or photo store in hosting settings; never use public pictures storage." : ""}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          Latest checked database copy: {timestamp(backup.latestVerifiedAt)}.
          Last complete database and photo recovery set: {timestamp(backup.lastCompleteAt)}.
          {backup.latestBytes != null ? " Latest database copy size: " + backup.latestBytes + " bytes." : ""}
        </p>
        <p className="mt-1 text-sm text-ink-soft">Daily copies are kept for {backup.retentionDays} days.
          Starting value 30 days, because daily copies need room for recovery.
          The newest working database backup and the last complete photo set are always kept, even after this limit.
        </p>
        {canPause ? <>
          <form action={saveBackupRetentionAction} className="mt-3 space-y-2">
            <input type="hidden" name="expected" value={backup.retentionDays} />
            <label htmlFor="backupRetentionDays" className="block text-sm font-medium text-ink">Keep daily backups for (days)</label>
            <input id="backupRetentionDays" name="days" type="number" min={7} max={365} step={1}
              defaultValue={backup.retentionDays} required className="w-40 rounded-control border border-line-strong bg-surface p-2 text-sm text-ink" />
            <p className="text-xs text-ink-soft">Between 7 and 365 days. Only the owner can change this. Does not delete the last working copy.</p>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="secondary">Save</Button>
              <Button type="submit" variant="secondary" name="operation" value="restore" formNoValidate>Restore recommended</Button>
            </div>
          </form>
          {backup.allowManualRetry ? <form action={retryBackupAction} className="mt-3">
            <Button type="submit" variant="secondary">Run the backup again</Button>
            <p className="mt-1 text-xs text-ink-soft">Available only after today&apos;s backup failed or ended without a clear result. A second click while one is running won&apos;t start another.</p>
          </form> : <p className="mt-3 text-sm text-ink-soft">A manual retry is offered after today&apos;s backup fails or has an uncertain result.</p>}
          {["verified","busy","failed","unavailable"].includes((await searchParams)?.backupMessage ?? "") ?
            <p role="status" className="mt-2 text-sm text-ink">{{
              verified: "The manual recovery run finished. Check the latest verified copy above.",
              busy: "A backup is already running; another copy was not started.",
              failed: "The backup did not finish. Read the job's failure details below.",
              unavailable: "A retry is not available right now. Reload and check the job.",
            }[(await searchParams)?.backupMessage as "verified"|"busy"|"failed"|"unavailable"]}</p> : null}
        </> : <p className="mt-2 text-sm text-ink-soft">Only the owner can change backup settings or retry a failed backup.</p>}
      </section>

      <HealthLegend />

      <section id="late-grace" aria-labelledby="late-grace-heading" className="mb-6 rounded-card border border-line bg-surface p-4">
        <h2 id="late-grace-heading" className="text-base font-bold text-ink">When a job counts as late</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Now {hoursAndMinutes(grace)} after a job&apos;s usual time. Starting value 2 hours, because a few jobs run
          back-to-back and the host can start them a little late.
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          Usual times follow the host&apos;s clock (UTC), so in Colorado they move one hour with daylight saving.
        </p>
        {canPause ? (
          <form action={saveLateGraceAction} className="mt-3 space-y-2">
            <input type="hidden" name="expected" value={grace} />
            <label htmlFor="graceMinutes" className="block text-sm font-medium text-ink">Minutes after the usual time</label>
            <input id="graceMinutes" name="graceMinutes" type="number" min={LATE_GRACE_MIN} max={LATE_GRACE_MAX} step={1}
              defaultValue={grace} required className="w-40 rounded-control border border-line-strong bg-surface p-2 text-sm text-ink" />
            <p className="text-xs text-ink-soft">Between {LATE_GRACE_MIN} minutes and 24 hours. Only the owner can change this.</p>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="secondary">Save</Button>
              <Button type="submit" variant="secondary" name="operation" value="restore" formNoValidate>Restore recommended</Button>
            </div>
          </form>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">Only the owner can change this.</p>
        )}
      </section>

      <div className="space-y-4">
        {health.map((item) => (
          <HealthRow key={item.ruleKey} row={item}>
            {canPause && (
              <form action={setAutomationPausedAction} className="mt-4">
                <input type="hidden" name="ruleKey" value={item.ruleKey} />
                <input type="hidden" name="paused" value={item.state === "paused" ? "false" : "true"} />
                <Button type="submit" variant="secondary">
                  {item.state === "paused" ? "Resume this automation" : "Pause this automation"}
                </Button>
              </form>
            )}
          </HealthRow>
        ))}
      </div>
    </div>
  );
}
