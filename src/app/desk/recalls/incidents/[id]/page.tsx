import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { getSafetyIncident } from "@/domains/recalls/reads";
import { CPSC_REPORT_URL } from "@/domains/recalls/hold";
import { IncidentDecision } from "./incident-decision";

export const metadata = { title: "Safety incident" };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const incident = await getSafetyIncident(id);
  if (!incident) notFound();
  const deadline = new Date(incident.createdAt.getTime() + 24 * 60 * 60 * 1000);
  return (
    <div className="space-y-6">
      <Link href="/desk/today" className="text-sm text-ink-soft hover:underline">&larr; Back to To do</Link>
      <PageHeader title="Injury or safety incident" />
      <Card>
        <p className="text-sm">{incident.description}</p>
        <p className="mt-2 text-sm text-ink-soft">
          Marked {formatBusinessDate(incident.createdAt)} at {formatBusinessTime(incident.createdAt)}
          {incident.appliance ? ` · ${incident.appliance.assetNumber} (${incident.appliance.applianceType.name})` : ""}
        </p>
        {incident.decision === "PENDING" && (
          <p className="mt-2 text-sm font-semibold">Decide by {formatBusinessDate(deadline)} at {formatBusinessTime(deadline)} whether to report it.</p>
        )}
      </Card>
      <Card title="Does it have to be reported?">
        <p className="text-sm text-ink-soft">
          A business that sells or distributes a product that could cause serious injury may have to tell the U.S. Consumer Product Safety Commission within 24 hours of learning about it.
          Whether renting counts as distributing is a question for your attorney; until you hear back, treat it as covered.
        </p>
        <p className="mt-3 text-sm"><a href={CPSC_REPORT_URL} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Report on SaferProducts.gov</a></p>
      </Card>
      {incident.decision === "PENDING" ? (
        <IncidentDecision incidentId={incident.id} />
      ) : (
        <Card title="Your decision">
          <p className="text-sm">{incident.decision === "REPORTED" ? "You reported it." : "You decided not to report it."} {incident.decisionNote}</p>
        </Card>
      )}
    </div>
  );
}
