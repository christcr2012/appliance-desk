import { requireRole } from "@/lib/session";
import { listMyFeedback } from "@/domains/feedback";
import { ButtonLink, PageHeader } from "@/components/ui";
import { MyReportsList } from "@/components/feedback/views";
import { firstParam } from "@/components/feedback/page-helpers";

export const metadata = { title: "My app feedback" };

// MCP-10a: the team member's own reports only (staff never see anyone else's).
export default async function DeskMyFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const params = await searchParams;
  const page = await listMyFeedback(firstParam(params.cursor));
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="My app feedback"
        primaryAction={<ButtonLink href="/desk/feedback/new?from=/desk/feedback/mine">App feedback</ButtonLink>}
      />
      <MyReportsList
        page={page}
        base="/desk/feedback/mine"
        newHref="/desk/feedback/new?from=/desk/feedback/mine"
        moreHref={page.nextCursor ? `/desk/feedback/mine?cursor=${encodeURIComponent(page.nextCursor)}` : null}
      />
    </div>
  );
}
