import { ContextCommunicationPanel } from "@/components/desk/context-communication-panel";
import { SendTextPanel } from "@/app/desk/_text/send-text-panel";
import { CallPanel } from "@/app/desk/_text/call-panel";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { requireRole } from "@/lib/session";
import { getMaintenanceRequestById } from "@/domains/maintenance";
import { MaintenanceDetailPanel } from "./maintenance-detail-panel";
import { SafetyIncidentButton } from "@/components/desk/safety-incident-button";
import { privatePhotoReadPath } from "@/lib/photo-storage";
import { RecordHeader, StatStrip } from "@/components/kit";
import { formatBusinessTime, relativeBusinessDay } from "@/lib/business-date";
import { jobTypeLabel, maintenancePriorityLabel } from "@/lib/status-labels";
import { REPAIR_PILL } from "@/domains/jobs/words";
import { visitPill } from "@/domains/jobs/words";

export const metadata = { title: "Repair request" };

type RepairTab = "problem" | "visits" | "messages";

export default async function MaintenanceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canScheduleJobs =
    session.user.role === "OWNER" || session.user.role === "ADMIN";
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: RepairTab = rawTab === "visits" || rawTab === "messages" ? rawTab : "problem";
  const request = await getMaintenanceRequestById(id);

  if (!request) {
    notFound();
  }
  const now = new Date();
  const customerName = request.customer.user.name ?? request.customer.user.email;
  const nextVisit = request.jobs
    .filter((job) => (job.status === "SCHEDULED" || job.status === "IN_PROGRESS") && job.scheduledAt)
    .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())[0];
  const tabHref = (value: RepairTab) => `/desk/maintenance/${request.id}?tab=${value}`;
  const tabClass = (active: boolean) =>
    `rounded-control px-3 py-2 text-sm font-semibold ${active ? "bg-ink text-white" : "text-ink-soft hover:bg-subtle"}`;

  return (
    <div className="max-w-2xl">
      <RecordHeader
        title={`Repair request for ${customerName}`}
        pills={[REPAIR_PILL[request.status]]}
        subtitle={
          request.appliance
            ? `${request.appliance.applianceType.name} #${request.appliance.assetNumber}`
            : "General request"
        }
        contact={{ email: request.customer.user.email }}
        back={{ href: "/desk/maintenance", label: "Repairs" }}
      />
      <StatStrip
        items={[
          { label: "Reported", value: relativeBusinessDay(request.openedAt, now) },
          { label: "Priority", value: maintenancePriorityLabel(request.priority) },
          { label: "Visits", value: String(request.jobs.length) },
          { label: "Photos", value: String(request.photos.length) },
        ]}
      />

      <nav aria-label="Repair request sections" className="mt-5 flex gap-1 border-b border-line pb-px">
        <Link href={tabHref("problem")} className={tabClass(tab === "problem")} aria-current={tab === "problem" ? "page" : undefined}>
          Problem
        </Link>
        <Link href={tabHref("visits")} className={tabClass(tab === "visits")} aria-current={tab === "visits" ? "page" : undefined}>
          Visits
        </Link>
        <Link href={tabHref("messages")} className={tabClass(tab === "messages")} aria-current={tab === "messages" ? "page" : undefined}>
          Messages
        </Link>
      </nav>

      {tab === "messages" && (
        <div className="mt-5">
          {canScheduleJobs && (
            <div>
              <SendTextPanel userId={session.user.id} entityType="MaintenanceRequest" entityId={request.id}
                path={`/desk/maintenance/${request.id}`} families={["maintenance_received", "maintenance_resolved"]}
                principal={{ customerId: request.customerId }} />
              <div className="mt-4"><CallPanel userId={session.user.id} subject={{ type: "MaintenanceRequest", id: request.id }} path={`/desk/maintenance/${request.id}`} /></div>
            </div>
          )}
          <ContextCommunicationPanel kind="MaintenanceRequest" id={request.id} />
        </div>
      )}

      {tab === "visits" && (
        <div className="mt-5 rounded-lg border border-line bg-white p-5">
          {request.jobs.length === 0 ? (
            <p className="text-sm text-ink-soft">No visits yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {request.jobs.map((job) => {
                const pill = visitPill(job);
                return (
                  <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/desk/jobs/${job.id}`} className="font-medium text-primary hover:underline">
                      {jobTypeLabel(job.type)}
                      {job.scheduledAt
                        ? ` · ${relativeBusinessDay(job.scheduledAt, now)} at ${formatBusinessTime(job.scheduledAt)}`
                        : " · No time yet"}
                    </Link>
                    <span className="text-ink-soft">{pill.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === "problem" && (
        <div>
          <div className="mt-5 rounded-lg border border-line bg-white p-5">
            <p className="text-sm text-ink-soft">{request.problem}</p>
          </div>

          {request.photos.length > 0 && (
            <div className="mt-4 rounded-lg border border-line bg-white p-5">
              <h2 className="font-medium text-ink">
                Photo{request.photos.length > 1 ? "s" : ""} from the customer
              </h2>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {request.photos.map((p) => {
                  const readUrl = privatePhotoReadPath(p.id);
                  return (
                    <a
                      key={p.id}
                      href={readUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="relative block h-32 w-full overflow-hidden rounded-lg"
                    >
                      <Image
                        src={readUrl}
                        alt={p.altText ?? "Photo of the problem from the customer"}
                        fill
                        sizes="(min-width: 640px) 33vw, 45vw"
                        className="object-cover"
                      />
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          <SafetyIncidentButton maintenanceRequestId={request.id} applianceId={request.applianceId} />

          <div className="mt-6">
            <MaintenanceDetailPanel
              request={request}
              canScheduleJobs={canScheduleJobs}
              nextVisitId={nextVisit?.id ?? null}
            />
          </div>
        </div>
      )}
    </div>
  );
}
