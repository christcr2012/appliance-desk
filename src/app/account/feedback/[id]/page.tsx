import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getMyFeedback } from "@/domains/feedback";
import { getFeedbackSettings } from "@/domains/feedback/settings";
import { MyReportView } from "@/components/feedback/views";
import { orNotFound } from "@/components/feedback/page-helpers";

export const metadata = { title: "My app feedback report", robots: { index: false, follow: false } };

// Only the report's own sender reaches it here; anyone else gets the same "not found" as a made-up address.
export default async function AccountFeedbackReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const [report, settings] = await Promise.all([orNotFound(() => getMyFeedback(id)), getFeedbackSettings()]);
  return (
    <div className="mx-auto max-w-3xl space-y-4" lang="en">
      <Link href="/account/feedback" className="inline-flex min-h-11 items-center text-sm font-semibold underline">
        My app feedback
      </Link>
      <MyReportView report={report} attachmentBase="/api/feedback-attachments" reopenDays={settings.reopenDays} />
    </div>
  );
}
