import { notFound } from "next/navigation";
import Link from "next/link";
import { getWorkOrderDetail } from "@/domains/jobs/work-order-detail";
import { WorkOrderDocument } from "@/components/jobs/work-order-document";
import { PrintDocumentButton } from "@/components/print-document-button";

export const metadata = {
  title: "Work order",
  robots: { index: false, follow: false },
};

export default async function WorkOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await getWorkOrderDetail(id);

  if (!job) {
    notFound();
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/desk/jobs/${job.id}`} className="text-sm text-gray-600 hover:underline">
          &larr; Back to job
        </Link>
        <PrintDocumentButton label="Print work order" />
      </div>

      <WorkOrderDocument job={job} />
    </div>
  );
}
