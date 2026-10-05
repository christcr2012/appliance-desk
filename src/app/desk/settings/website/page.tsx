import Link from "next/link";
import { requireRole } from "@/lib/session";
import { PageHeader, SectionCard, secondaryActionClass } from "@/components/desk/workspace";
import { SITE_FIELDS } from "@/domains/site-content/fields";
import { getEditorState, listPublishedHistory } from "@/domains/site-content";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { WebsiteEditor } from "./website-editor";

export const metadata = { title: "Website text", robots: { index: false, follow: false } };

export default async function WebsiteTextPage() {
  await requireRole("OWNER", "ADMIN");
  const [state, history] = await Promise.all([getEditorState(), listPublishedHistory()]);
  const defaults = Object.fromEntries(SITE_FIELDS.map((f) => [f.key, f.default]));
  const live = { ...defaults, ...(state.published?.stored ?? {}) };
  const start = { ...live, ...(state.draft?.stored ?? {}) };
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Website text"
        description="Change the wording on your public website. Nothing reaches the public until you publish."
        secondaryActions={
          <Link className={secondaryActionClass} href="/desk/settings?section=website">
            Back to website settings
          </Link>
        }
      />
      <SectionCard title="How this works">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>Edit the text below and choose <strong>Save draft</strong>. Visitors still see the old text.</li>
          <li>Use the <strong>Preview</strong> links to see your draft on the real page. Only you and other owners or admins can see a preview.</li>
          <li>When you are happy, choose <strong>Publish</strong>. You can always put an older version back from the history at the bottom.</li>
          <li>Prices, phone, email, address and service area are not here. They come from your price list and Settings.</li>
        </ul>
      </SectionCard>
      <WebsiteEditor
        fields={SITE_FIELDS.map((f) => ({ ...f }))}
        defaults={defaults}
        live={live}
        start={start}
        draft={state.draft ? { id: state.draft.id, version: state.draft.version } : null}
        history={history.map((h) => ({
          id: h.id,
          version: h.version,
          live: h.status === "PUBLISHED",
          when: `${formatBusinessDate(h.publishedAt!)} · ${formatBusinessTime(h.publishedAt!)}`,
          by: h.publishedBy,
          note: h.note,
        }))}
      />
    </div>
  );
}
