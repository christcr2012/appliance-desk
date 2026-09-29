import { notFound } from "next/navigation";
import Link from "next/link";
import { getJobById } from "@/domains/jobs";
import { JobDetailPanel } from "./job-detail-panel";

export const metadata = { title: "Job" };

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await getJobById(id);

  if (!job) {
    notFound();
  }

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
        <JobDetailPanel job={job} />
      </div>
    </div>
  );
}
