import { headers } from "next/headers";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getFeedbackSettings } from "@/domains/feedback/settings";
import { PageHeader } from "@/components/ui";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { RepairsPointer } from "@/components/feedback/views";
import { contextSummaryFor, firstParam } from "@/components/feedback/page-helpers";

export const metadata = { title: "Tell us about the app" };

// MCP-10a: everyone on the team can send app feedback (whatever their job role).
export default async function DeskFeedbackNewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const params = await searchParams;
  const from = firstParam(params.from) ?? "/desk/today";
  const [settings, requestHeaders] = await Promise.all([getFeedbackSettings(), headers()]);
  return (
    <div className="min-w-0 max-w-2xl space-y-5 [overflow-wrap:anywhere]">
      <Link href="/desk/feedback/mine" className="inline-flex min-h-11 items-center text-sm font-semibold underline">
        My app feedback
      </Link>
      <PageHeader title="Tell us about the app" />
      <RepairsPointer area="desk" />
      <FeedbackForm
        area="desk"
        from={from}
        maxAttachments={settings.maxAttachments}
        contextSummary={contextSummaryFor(from, requestHeaders.get("user-agent"), "en")}
      />
    </div>
  );
}
