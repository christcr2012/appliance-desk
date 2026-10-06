import { requireRole } from "@/lib/session";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { SITE_FIELDS } from "@/domains/site-content/fields";
import {
  getEditorState,
  listPublishedHistory,
} from "@/domains/site-content";
import {
  formatBusinessDate,
  formatBusinessTime,
} from "@/lib/business-date";
import { WebsiteEditor } from "./website-editor";

export const metadata = {
  title: "Website text",
  robots: { index: false, follow: false },
};

export default async function WebsiteTextPage() {
  await requireRole("OWNER", "ADMIN");
  const [state, history] = await Promise.all([
    getEditorState(),
    listPublishedHistory(),
  ]);
  const defaults = Object.fromEntries(
    SITE_FIELDS.map((field) => [field.key, field.default]),
  );
  const live = { ...defaults, ...(state.published?.stored ?? {}) };
  const start = { ...live, ...(state.draft?.stored ?? {}) };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Website text"
        description="Change the wording on your public website. Nothing reaches the public until you publish."
        secondaryActions={
          <ButtonLink
            href="/desk/settings?section=website"
            variant="secondary"
          >
            Back to website settings
          </ButtonLink>
        }
      />

      <Card title="How this works">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>
            Edit the text below and choose <strong>Save draft</strong>.
            Visitors still see the old text.
          </li>
          <li>
            Use the <strong>Preview</strong> links to see your draft on the
            real page. Only you and other owners or admins can see a preview.
          </li>
          <li>
            When you are happy, choose <strong>Publish</strong>. You can
            always put an older version back from the history at the bottom.
          </li>
          <li>
            Prices, phone, email, address and service area are not here. They
            come from your price list and Settings.
          </li>
        </ul>
      </Card>

      <WebsiteEditor
        fields={SITE_FIELDS.map((field) => ({ ...field }))}
        defaults={defaults}
        live={live}
        start={start}
        draft={
          state.draft
            ? { id: state.draft.id, version: state.draft.version }
            : null
        }
        history={history.map((item) => ({
          id: item.id,
          version: item.version,
          live: item.status === "PUBLISHED",
          when: `${formatBusinessDate(item.publishedAt!)} · ${formatBusinessTime(
            item.publishedAt!,
          )}`,
          by: item.publishedBy,
          note: item.note,
        }))}
      />
    </div>
  );
}
