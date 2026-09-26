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

      <h1 className="mt-2 text-xl font-semibold">{job.type}</h1>
      <p className="mt-1 text-sm text-gray-600">
        {job.customer && (job.customer.user.name ?? job.customer.user.email)}
        {job.serviceAddress &&
          ` · ${job.serviceAddress.line1}, ${job.serviceAddress.city}, ${job.serviceAddress.state} ${job.serviceAddress.zip}`}
      </p>

      <div className="mt-6">
        <JobDetailPanel job={job} />
      </div>
    </div>
  );
}
