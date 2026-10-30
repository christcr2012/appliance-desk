import { requireRole } from "@/lib/session";
import { getMyFeedback } from "@/domains/feedback";
import { getFeedbackSettings } from "@/domains/feedback/settings";
import { MyReportView } from "@/components/feedback/views";
import { orNotFound } from "@/components/feedback/page-helpers";
import { RecordHeader } from "@/components/kit";
import { kindWords } from "@/domains/feedback/rules";

export const metadata = { title: "My app feedback report" };

// The sender's view of their own report. Another person's report looks exactly like a made-up address.
export default async function DeskMyFeedbackReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const { id } = await params;
  const [report, settings] = await Promise.all([orNotFound(() => getMyFeedback(id)), getFeedbackSettings()]);
  return (
    <div className="max-w-3xl space-y-4">
      <RecordHeader
        title={report.title}
        subtitle={`Report #${report.number} · ${kindWords(report.kind)}`}
        back={{ href: "/desk/feedback/mine", label: "My app feedback" }}
      />
      <MyReportView report={report} attachmentBase="/api/feedback-attachments" reopenDays={settings.reopenDays} hideHeader />
    </div>
  );
}
