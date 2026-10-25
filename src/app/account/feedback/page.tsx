import { requireSession } from "@/lib/session";
import { listMyFeedback } from "@/domains/feedback";
import { ButtonLink, PageHeader } from "@/components/ui";
import { MyReportsList } from "@/components/feedback/views";
import { firstParam } from "@/components/feedback/page-helpers";

export const metadata = { title: "My app feedback", robots: { index: false, follow: false } };

// MCP-10a: the signed-in person's own app feedback reports (never anyone else's). English only for now.
export default async function AccountFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const params = await searchParams;
  const page = await listMyFeedback(firstParam(params.cursor));
  return (
    <div className="mx-auto max-w-3xl" lang="en">
      <PageHeader
        title="My app feedback"
        primaryAction={<ButtonLink href="/account/feedback/new?from=/account/feedback">App feedback</ButtonLink>}
      />
      <MyReportsList
        page={page}
        base="/account/feedback"
        newHref="/account/feedback/new?from=/account/feedback"
        moreHref={page.nextCursor ? `/account/feedback?cursor=${encodeURIComponent(page.nextCursor)}` : null}
      />
    </div>
  );
}
