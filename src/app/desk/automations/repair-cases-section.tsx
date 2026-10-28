import Link from "next/link";
import { Card, Button, StatusPill } from "@/components/ui";
import { formatBusinessDate } from "@/lib/business-date";
import type { RepairStage } from "@prisma/client";
import { checkRepairCaseAction, stopRepairCaseAction } from "./actions";

const WORDS: Record<RepairStage, string> = {
  PROPOSED: "Waiting to start",
  IN_PROGRESS: "Being worked on",
  PR_OPEN: "Change ready for review",
  MERGED: "Change accepted",
  DEPLOYED: "Live, needs checking",
  VERIFIED: "Checked and fixed",
  REJECTED: "Declined",
  SUPERSEDED: "Replaced by another case",
  FAILED: "Didn't fix it",
  BLOCKED: "Needs more evidence",
};

type RepairRow = {
  id: string; number: number; title: string; sourceKind: string; sourceId: string;
  stage: RepairStage; blocker: string | null; prNumber: number | null;
  createdAt: Date; updatedAt: Date; verifiedAt: Date | null;
};

export function RepairCasesSection({ rows, canManage }: { rows: RepairRow[]; canManage: boolean }) {
  return (
    <section id="repairs" aria-labelledby="repairs-heading" className="mb-8 space-y-4 scroll-mt-4">
      <div>
        <h2 id="repairs-heading" className="text-xl font-semibold text-ink">Repairs</h2>
        <p className="mt-1 text-sm text-ink-soft">A change is only called fixed after its release and a separate check. An open problem stays open until then.</p>
      </div>
      {rows.length === 0 ? (
        <Card title="No software repairs tracked" description="Problems the system finds appear above.">
          <p className="text-sm text-ink-soft">There are no repair cases on this page.</p>
        </Card>
      ) : rows.map(row => (
        <Card key={row.id} title={`Repair #${row.number}: ${row.title}`}
          description={`Recorded ${formatBusinessDate(row.createdAt)} · ${row.sourceKind === "FEEDBACK" ? "Report" : "System problem"}`}
          actions={<StatusPill tone={row.stage === "VERIFIED" ? "success" : row.stage === "FAILED" ? "attention" : "pending"} label={WORDS[row.stage]} />}>
          <div className="space-y-3 text-sm">
            {row.blocker && <p role="status" className="text-ink-soft">Why it is waiting: {row.blocker.replaceAll("_", " ").toLowerCase()}</p>}
            {row.prNumber && <p><Link className="font-medium underline" href={`https://github.com/christcr2012/appliance-desk/pull/${row.prNumber}`} target="_blank" rel="noopener noreferrer">View change #{row.prNumber} on GitHub</Link></p>}
            {row.verifiedAt && <p>Checked {formatBusinessDate(row.verifiedAt)}</p>}
            {!["VERIFIED", "REJECTED", "SUPERSEDED"].includes(row.stage) && (
              <div className="flex flex-wrap gap-3">
                <form action={checkRepairCaseAction}>
                  <input type="hidden" name="caseId" value={row.id} />
                  <Button type="submit" variant="secondary">Check evidence again</Button>
                </form>
                {canManage && (
                  <form action={stopRepairCaseAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="caseId" value={row.id} />
                    <label className="sr-only" htmlFor={`repair-reason-${row.id}`}>Reason for stopping repair #{row.number}</label>
                    <input id={`repair-reason-${row.id}`} name="reason" required maxLength={500}
                      placeholder="Reason" className="rounded-control border border-line-strong bg-surface p-2 text-sm" />
                    <Button type="submit" variant="secondary" name="stage" value="REJECTED">Decline repair</Button>
                  </form>
                )}
              </div>
            )}
          </div>
        </Card>
      ))}
    </section>
  );
}
