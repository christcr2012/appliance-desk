import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { getWatchStatus, listApplianceTypeTerms, listRecallSummaries } from "@/domains/recalls/reads";
import { termsForType } from "@/domains/recalls/watch";
import { FleetCheckButton } from "./fleet-check-button";
import { TermsEditor } from "./terms-editor";

export const metadata = { title: "Recalls" };

export default async function RecallsPage() {
  await requireRole("OWNER", "ADMIN");
  const [recalls, watch, types] = await Promise.all([listRecallSummaries(), getWatchStatus(), listApplianceTypeTerms()]);
  const lastCheck = watch.state?.lastSuccessAt;
  return (
    <main className="space-y-8">
      <PageHeader title="Recalls" />
      <Card title="Recall check">
        <p className="text-sm text-ink-soft" data-testid="recall-check-status">
          {lastCheck
            ? `Last checked ${formatBusinessDate(lastCheck)} at ${formatBusinessTime(lastCheck)}.`
            : "The first check hasn't run yet. It runs each night and looks at all your appliances the first time."}{" "}
          {watch.fleetSize} appliances are checked against the government&apos;s recall list. Nothing is blocked until you confirm a match.
        </p>
        {watch.state?.lastError && (
          <p role="alert" className="mt-2 text-sm font-semibold text-danger">The last check had a problem: {watch.state.lastError}</p>
        )}
        <div className="mt-4"><FleetCheckButton /></div>
      </Card>
      {recalls.length === 0 ? (
        <EmptyState title="No recalls to check" description="When the government posts a recall that may cover one of your appliances, it shows up here and on your To do list." />
      ) : (
        <ul className="space-y-3" aria-label="Recalls">
          {recalls.map((recall) => (
            <li key={recall.recallId} className="rounded-card border border-line bg-surface p-4">
              <Link href={`/desk/recalls/${encodeURIComponent(recall.recallId)}`} className="font-semibold text-ink underline">
                {recall.title}
              </Link>
              <p className="mt-1 text-sm text-ink-soft">
                {recall.publishedAt ? `Posted ${formatBusinessDate(recall.publishedAt)} · ` : ""}
                {recall.counts.POSSIBLE > 0 ? `${recall.counts.POSSIBLE} to check · ` : ""}
                {recall.counts.CONFIRMED > 0 ? `${recall.counts.CONFIRMED} on hold · ` : ""}
                {recall.counts.REMEDIED > 0 ? `${recall.counts.REMEDIED} fixed · ` : ""}
                {recall.counts.NOT_OURS > 0 ? `${recall.counts.NOT_OURS} not ours` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Card title="Search words" description="The nightly check searches the recall list with these words for each kind of appliance. If you leave a row empty, the kind's name is used.">
        <div className="space-y-4">
          {types.map((type) => (
            <TermsEditor key={type.id} typeId={type.id} typeName={type.name} initial={type.recallProductTerms.join(", ")} fallback={termsForType(type).join(", ")} />
          ))}
        </div>
      </Card>
    </main>
  );
}
