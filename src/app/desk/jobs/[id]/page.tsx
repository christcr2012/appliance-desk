import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getDeskJobById } from "@/domains/desk-access";
import { JobDetailPanel } from "./job-detail-panel";
import { privatePhotoReadPath } from "@/lib/photo-storage";
import { deliveryCandidatesForJob } from "@/domains/jobs";
import { pendingDeliveriesForJob } from "@/domains/billing/pickup-billing-events";
import { businessDateKey } from "@/lib/business-date";

export const metadata = { title: "Job" };

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
  const [deliveryCandidates, pendingDeliveries] = await Promise.all([
    deliveryCandidatesForJob({ id: job.id, type: job.type, status: job.status, agreementId: job.agreementId }),
    pendingDeliveriesForJob(job.id),
  ]);

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
        <JobDetailPanel deliveryCandidates={deliveryCandidates} pendingDeliveries={pendingDeliveries.map((p) => ({
          id: p.id,
          label: `${p.appliance.applianceType.name} #${p.appliance.assetNumber}`,
          originalDeliveryDate: businessDateKey(p.originalDeliveryDate),
          deliveredOn: p.deliveredOn ? businessDateKey(p.deliveredOn) : null,
          removed: p.removedAt !== null,
          hasCredit: p.creditId !== null,
        }))} today={businessDateKey(new Date())} job={{
          id: job.id, type: job.type, status: job.status,
          completionNotes: job.completionNotes, checklist: job.checklist,
          swapReplacementIds: job.swapReplacementIds,
          appliances: job.appliances.map(({ appliance }) => ({ appliance: {
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
