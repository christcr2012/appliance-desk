import { headers } from "next/headers";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { readCustomerLanguage } from "@/domains/language";
import { getFeedbackSettings } from "@/domains/feedback/settings";
import { PageHeader } from "@/components/ui";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { RepairsPointer } from "@/components/feedback/views";
import { contextSummaryFor, firstParam } from "@/components/feedback/page-helpers";

export const metadata = { title: "Tell us about the app", robots: { index: false, follow: false } };

export default async function AccountFeedbackNewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const from = firstParam(params.from) ?? "/account";
  const [settings, language, requestHeaders] = await Promise.all([
    getFeedbackSettings(),
    readCustomerLanguage(session.user.id),
    headers(),
  ]);
  return (
    <div className="mx-auto max-w-2xl space-y-5" lang="en">
      <Link href="/account/feedback" className="inline-flex min-h-11 items-center text-sm font-semibold underline">
        My app feedback
      </Link>
      <PageHeader title="Tell us about the app" />
      <RepairsPointer area="account" />
      <FeedbackForm
        area="account"
        from={from}
        maxAttachments={settings.maxAttachments}
        contextSummary={contextSummaryFor(from, requestHeaders.get("user-agent"), language)}
      />
    </div>
  );
}
