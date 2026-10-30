import { getObservations, PERFORMANCE_NAMES } from "@/domains/agent-control/performance";
import { listOptimizationProposals } from "@/domains/agent-control/optimization";
import { Button } from "@/components/ui";
import { createOptimizationProposalAction, reviewOptimizationProposalAction } from "./actions";

/** All measurements are aggregates of safe labels, never visitor or customer information. */
export async function ImprovementsSection({ userId, canManage }: { userId: string; canManage: boolean }) {
  const [data, proposals] = await Promise.all([
    getObservations({ window: "7d" }),
    listOptimizationProposals(userId),
  ]);
  const eligible = data.rows.filter(row => row.status === "ENOUGH");
  return (
    <section id="improvements" aria-labelledby="improvements-heading"
      className="mb-8 space-y-4 rounded-card border border-line bg-surface p-4">
      <div>
        <h2 id="improvements-heading" className="text-xl font-semibold text-ink">Measured improvements</h2>
        <p className="mt-1 text-sm text-ink-soft">
          The app samples about one in ten page and action timings and records job timings.
          Every measurement uses a fixed page, action, job or query label, never a customer name or URL.
          Data older than 30 days is removed in bounded nightly batches.
        </p>
        <p className="mt-1 text-xs text-ink-soft">Seven-day window: {data.start.slice(0,10)} to {data.end.slice(0,10)}.
          Fewer than 30 samples means there is not enough data to judge speed.
          Improvement proposals never change a setting by themselves.</p>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {data.rows.filter(row => row.samples > 0).map(row => (
          <div key={row.kind + row.name} className="min-w-0 rounded-control border border-line p-3 text-sm">
            <p className="font-medium text-ink">{row.kind.toLowerCase()} · {row.name.replaceAll("-", " ")}</p>
            <p className="text-ink-soft">{row.samples} samples · {row.status === "ENOUGH"
              ? `Typical ${row.p50Ms} ms; slow 5% ${row.p95Ms} ms; failures ${row.errorRatePercent}%`
              : row.message}</p>
            {row.p95ChangePercent !== null ? <p className="text-xs text-ink-soft">
              Compared with the prior seven days: {row.p95ChangePercent}% change in slow-end time.
            </p> : null}
          </div>
        ))}
        {!data.rows.some(row => row.samples > 0) ?
          <p className="text-sm text-ink-soft">Not enough data yet. Timings appear after everyday use of the app.</p>
          : null}
      </div>
      {canManage && eligible.length > 0 ? (
        <form action={createOptimizationProposalAction} className="space-y-3 rounded-control border border-line p-3">
          <h3 className="font-semibold text-ink">Propose a reversible improvement</h3>
          <label className="block text-sm">Measurement
            <select name="measurement" className="mt-1 block w-full min-w-0 rounded-control border border-line-strong bg-surface p-2">
              {eligible.map(row => <option key={row.kind + row.name}
                value={row.kind + "::" + row.name}>{row.kind}: {row.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">Title
            <input name="title" minLength={3} maxLength={160} required
              className="mt-1 block w-full rounded-control border border-line-strong bg-surface p-2" />
          </label>
          {([
            ["expectedBenefit", "Expected improvement"],
            ["risk", "What could go wrong"],
            ["costNote", "Cost and spending implications"],
            ["measurementPlan", "How to measure success"],
            ["rollback", "How to undo the change"],
          ] as const).map(([name, label]) =>
            <label key={name} className="block text-sm">{label}
              <textarea name={name} minLength={3} maxLength={name === "costNote" ? 500 : 2000}
                rows={2} required className="mt-1 block w-full rounded-control border border-line-strong bg-surface p-2" />
            </label>)}
          <Button type="submit" variant="secondary">Save proposal (no changes applied)</Button>
        </form>
      ) : canManage ? <p className="text-sm text-ink-soft">
        Proposal creation is unavailable until one measurement has at least 30 samples.
      </p> : null}
      <div>
        <h3 className="font-semibold text-ink">Review proposals</h3>
        {!proposals.length ? <p className="text-sm text-ink-soft">No improvement proposals yet.</p> :
          <ul className="mt-2 space-y-2">{proposals.map(item =>
            <li key={item.id} className="rounded-control border border-line p-3 text-sm">
              <p className="font-medium text-ink">#{item.number} {item.title} · {item.state}</p>
              <p className="text-ink-soft">{item.expectedBenefit}</p>
              <p className="text-xs text-ink-soft">Risk: {item.risk}</p>
              <p className="text-xs text-ink-soft">Check: {item.measurementPlan}</p>
              <p className="text-xs text-ink-soft">Rollback: {item.rollback}</p>
              {canManage && item.state === "PROPOSED" ?
                <form action={reviewOptimizationProposalAction} className="mt-2 flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={item.id} />
                  <Button type="submit" name="decision" value="accept" variant="secondary">
                    Accept for engineering review
                  </Button>
                  <Button type="submit" name="decision" value="reject" variant="secondary">Decline</Button>
                </form> : null}
            </li>)}</ul>}
      </div>
      <p className="text-xs text-ink-soft">Neither a proposal nor accepting it grants permission to edit prices,
        fees, taxes, signed terms, or hosting services. Engineering changes still require their own review and CI.</p>
    </section>
  );
}

export const OBSERVABLE_NAMES = PERFORMANCE_NAMES;
