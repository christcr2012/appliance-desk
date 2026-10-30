import { notFound } from "next/navigation";
import { getWorkOrderDetail } from "@/domains/jobs/work-order-detail";
import { WorkOrderDocument } from "@/components/jobs/work-order-document";
import { PrintDocumentButton } from "@/components/print-document-button";
import { RecordHeader } from "@/components/kit";

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
      <div className="mb-4 flex items-start justify-between gap-3 print:hidden">
        <div className="min-w-0 flex-1">
          <RecordHeader title="Work order" back={{ href: `/desk/jobs/${job.id}`, label: "Job" }} />
        </div>
        <PrintDocumentButton label="Print work order" />
      </div>

      <WorkOrderDocument job={job} />
    </div>
  );
}
