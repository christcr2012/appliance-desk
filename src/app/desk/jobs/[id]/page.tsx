import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getDeskJobById } from "@/domains/desk-access";
import { JobDetailPanel } from "./job-detail-panel";
import { JobSchedulePanel } from "./job-schedule-panel";
import { JobPartsUsed } from "./job-parts-used";
import { getJobPartsUsed } from "@/domains/purchasing";
import { getAllPartRecords } from "@/domains/inventory";
import { getAssignableTeamMembers } from "@/domains/staff";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { privatePhotoReadPath } from "@/lib/photo-storage";
import { getJobCompletionScope } from "@/domains/jobs";
import { pendingDeliveriesForJob } from "@/domains/billing/pickup-billing-events";
import { substituteChoices } from "@/domains/jobs/substitution";
import { businessDateKey } from "@/lib/business-date";

export const metadata = { title: "Job" };

/** An instant as the Colorado clock reading a date-time box expects (YYYY-MM-DDTHH:mm). */
function denverLocalInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function assignedLabel(id: string | null, team: Array<{ id: string; name: string | null; email: string }>): string | null {
  if (!id) return null;
  const member = team.find((m) => m.id === id);
  return member ? (member.name ?? member.email) : "Assigned";
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canViewFinance = session.user.role === "OWNER" || session.user.role === "ADMIN";
  const { id } = await params;
  const job = await getDeskJobById(id);

  if (!job) {
    notFound();
  }
  const showParts = canViewFinance && job.type === "MAINTENANCE_VISIT";
  const [teamMembers, partsUsed, partOptions, completionScope, pendingDeliveries] = await Promise.all([
    canViewFinance ? getAssignableTeamMembers() : Promise.resolve([]),
    showParts ? getJobPartsUsed(job.id) : Promise.resolve(null),
    showParts ? getAllPartRecords() : Promise.resolve([]),
    getJobCompletionScope({ id: job.id, type: job.type, status: job.status, agreementId: job.agreementId }),
    pendingDeliveriesForJob(job.id),
  ]);

  const choices = canViewFinance
    ? new Map(await Promise.all(pendingDeliveries.filter((p) => !p.deliveredOn && !p.removedAt && !p.substituteJobId).map(async (p) => [p.id, await substituteChoices(p.id)] as const)))
    : new Map<string, Awaited<ReturnType<typeof substituteChoices>>>();

  return (
    <div className="max-w-2xl">
      <Link href="/desk/jobs" className="text-sm text-gray-600 hover:underline">
        &larr; Back to jobs
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{job.type}</h1>
        <Link
          href={`/desk/jobs/${job.id}/work-order`}
          className="text-sm text-primary hover:underline"
        >
          View / print work order &rarr;
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {job.customer && (job.customer.user.name ?? job.customer.user.email)}
        {job.serviceAddress &&
          ` · ${job.serviceAddress.line1}, ${job.serviceAddress.city}, ${job.serviceAddress.state} ${job.serviceAddress.zip}`}
      </p>

      {job.maintenanceRequest && (
        <p className="mt-1 text-sm">
          <Link
            href={`/desk/maintenance/${job.maintenanceRequest.id}`}
            className="text-primary hover:underline"
          >
            &rarr; Scheduled for a maintenance request
          </Link>
        </p>
      )}

      <div className="mt-6">
        <JobSchedulePanel
          jobId={job.id}
          version={job.version}
          status={job.status}
          scheduledAtLocal={job.scheduledAt ? denverLocalInput(job.scheduledAt) : ""}
          scheduledLabel={job.scheduledAt ? `${formatBusinessDate(job.scheduledAt)} at ${formatBusinessTime(job.scheduledAt)}` : null}
          durationMinutes={job.durationMinutes}
          assignedToUserId={job.assignedToUserId}
          assignedLabel={assignedLabel(job.assignedToUserId, teamMembers)}
          teamMembers={teamMembers.map((m) => ({ id: m.id, label: m.name ?? m.email }))}
          canSchedule={canViewFinance}
          canMarkNoShow={canViewFinance || job.assignedToUserId === session.user.id}
          noShowAt={"noShowAt" in job && job.noShowAt ? job.noShowAt.toISOString() : null}
        />
      </div>

      {partsUsed && (
        <div className="mt-6">
          <JobPartsUsed
            jobId={job.id}
            rows={partsUsed.rows}
            cost={partsUsed.cost}
            partOptions={partOptions.map((p) => ({
              id: p.id,
              label: `${p.modelNumber} — ${p.partNumber}${p.partName ? ` (${p.partName})` : ""}`,
              onHand: p.quantityOnHand,
            }))}
          />
        </div>
      )}

      <div className="mt-6">
        <JobDetailPanel partsFromList={partsUsed?.cost.source === "ITEMIZED"} completionScope={completionScope} version={job.version} outcome={"outcome" in job ? (job.outcome ?? null) : null} pendingDeliveries={pendingDeliveries.map((p) => ({
          id: p.id,
          label: `${p.appliance.applianceType.name} #${p.appliance.assetNumber}`,
          originalDeliveryDate: businessDateKey(p.originalDeliveryDate),
          deliveredOn: p.deliveredOn ? businessDateKey(p.deliveredOn) : null,
          removed: p.removedAt !== null,
          hasCredit: p.creditId !== null,
          stripeUpdatePending: p.stripeUpdatePending,
          substituteLabel: p.substituteAppliance ? `#${p.substituteAppliance.assetNumber}` : null,
          substituteUnits: choices.get(p.id)?.units ?? [],
          substituteVisits: choices.get(p.id)?.visits ?? [],
        }))} today={businessDateKey(new Date())} job={{
          id: job.id, type: job.type, status: job.status,
          completionNotes: job.completionNotes, checklist: job.checklist,
          swapReplacementIds: job.swapReplacementIds,
          appliances: job.appliances.map(({ appliance, result, role }) => ({ result: result ?? null, role, appliance: {
            id: appliance.id, assetNumber: appliance.assetNumber, status: appliance.status,
            applianceType: { name: appliance.applianceType.name },
          } })),
          photos: job.photos.map(({ id: photoId, altText }) => ({
            id: photoId,
            url: privatePhotoReadPath(photoId),
            altText,
          })),
          ...(job.canViewFinance ? { partsCostCents: job.partsCostCents, laborCostCents: job.laborCostCents } : {}),
        }} canViewFinance={canViewFinance} />
      </div>
    </div>
  );
}
