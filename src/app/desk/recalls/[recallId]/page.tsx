import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { formatBusinessDate } from "@/lib/business-date";
import { getRecallDetail } from "@/domains/recalls/reads";
import { draftRenterMessage } from "@/domains/recalls/hold";
import { MatchRow } from "./match-row";

export const metadata = { title: "Recall" };

export default async function RecallPage({ params }: { params: Promise<{ recallId: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { recallId } = await params;
  const recall = await getRecallDetail(decodeURIComponent(recallId));
  if (!recall) notFound();
  return (
    <main className="space-y-6">
      <Link href="/desk/recalls" className="text-sm text-ink-soft hover:underline">&larr; Back to recalls</Link>
      <PageHeader title={recall.title} />
      <Card title="What the government says">
        <dl className="grid gap-2 text-sm">
          <div><dt className="font-semibold">Recall number</dt><dd>{recall.recallNumber}{recall.publishedAt ? ` · posted ${formatBusinessDate(recall.publishedAt)}` : ""}</dd></div>
          {recall.hazard && <div><dt className="font-semibold">The danger</dt><dd>{recall.hazard}</dd></div>}
          <div><dt className="font-semibold">The fix</dt><dd>{recall.remedy ?? "No fix is listed yet."}</dd></div>
        </dl>
        <p className="mt-3 text-sm"><a href={recall.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Read the full government notice</a></p>
      </Card>
      <section aria-label="Appliances that may be covered" className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Your appliances that may be covered</h2>
        <p className="text-sm text-ink-soft">Check the model number on the machine&apos;s label against the notice. Choosing &ldquo;It&apos;s ours&rdquo; puts the machine on hold: it can&apos;t be rented, reserved, swapped in or sold until you record the fix.</p>
        <ul className="space-y-3">
          {recall.matches.map((match) => (
            <MatchRow
              key={match.id}
              matchId={match.id}
              state={match.state}
              title={`${match.appliance.assetNumber} — ${match.appliance.typeName}`}
              detail={[match.appliance.manufacturer, match.appliance.model].filter(Boolean).join(" ") || "No model entered"}
              serial={match.appliance.serialNumber}
              reason={match.matchReason}
              decisionNote={match.decisionNote}
              renters={match.renters}
              applianceHref={`/desk/inventory/${match.appliance.id}`}
              drafts={match.renters.map((name) => ({
                name,
                text: draftRenterMessage({
                  customerName: name,
                  applianceLabel: [match.appliance.manufacturer, match.appliance.typeName.toLowerCase()].filter(Boolean).join(" "),
                  title: recall.title, remedy: recall.remedy, url: recall.url,
                }),
              }))}
            />
          ))}
        </ul>
      </section>
    </main>
  );
}
