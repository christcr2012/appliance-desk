import Link from "next/link";
import { requireRole } from "@/lib/session";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { editorFields } from "@/domains/site-content/editor-fields";
import { WEBSITE_PAGES } from "@/domains/site-content/pages";
import { siteFacts } from "@/domains/site-content/facts";
import { listWebsiteAssets } from "@/domains/site-content/assets";
import { getDraftReview, getEditorValueState, getWebsiteOverview, listPublishedHistory, siteDefaultValues } from "@/domains/site-content";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { HistoryPanel } from "./history-panel";
import { ReviewPanel } from "./review-panel";
import { WebsiteWorkspace, type WorkspacePage } from "./workspace";

export const metadata = { title: "Website", robots: { index: false, follow: false } };

type SearchParams = { view?: string; page?: string; key?: string; focus?: string };

const when = (date: Date | null) => (date ? `${formatBusinessDate(date)} · ${formatBusinessTime(date)}` : "not yet");

function citySlug(city: string) {
  return city.trim().toLowerCase().replace(/\s+/g, "-");
}

export default async function WebsitePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireRole("OWNER", "ADMIN");
  const params = await searchParams;
  const view = params.view === "edit" || params.view === "review" || params.view === "history" ? params.view : "overview";
  const settings = await getBusinessSettings();
  const facts = siteFacts(settings);
  const nowIso = new Date().toISOString();
  const firstCity = parseServiceArea(settings).cities[0];
  const cityPath = firstCity && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(citySlug(firstCity)) ? `/rent/${citySlug(firstCity)}` : null;
  const pages: WorkspacePage[] = WEBSITE_PAGES.map((p) => ({
    id: p.id,
    name: p.name,
    about: p.about,
    previewPath: p.cityPage ? cityPath : p.previewPath,
    beforeOpeningOnly: p.beforeOpeningOnly === true,
    note: p.beforeOpeningOnly ? "This page shows only while the website is set to “preparing to launch”, so the preview may show the other home page." : p.cityPage ? "The preview shows your first city." : null,
  }));
  const pagePaths = Object.fromEntries(pages.map((p) => [p.id, p.previewPath]));

  const back = (
    <ButtonLink href="/desk/settings/website" variant="secondary">Website overview</ButtonLink>
  );

  if (view === "edit") {
    const [state, assets] = await Promise.all([getEditorValueState(), listWebsiteAssets()]);
    const focus = params.focus;
    return (
      <div className="max-w-7xl">
        <PageHeader title={focus === "photos" ? "Photos and promotions" : focus === "contact" ? "Contact and prices" : "Edit a page"} description="Pick what to change. Nothing reaches visitors until you review and publish." secondaryActions={back} />
        <WebsiteWorkspace
          pages={pages}
          fields={editorFields()}
          defaults={siteDefaultValues()}
          liveStored={state.published?.values ?? {}}
          startValues={state.draft?.values ?? state.published?.values ?? {}}
          draft={state.draft ? { id: state.draft.id, version: state.draft.version } : null}
          liveRevisionId={state.published?.id ?? null}
          assets={assets.map((a) => ({ id: a.id, state: a.state, width: a.width, height: a.height, previewPath: a.previewPath }))}
          facts={Object.fromEntries(Object.entries(facts).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>}
          nowIso={nowIso}
          initialPageId={params.page}
          initialKey={params.key}
          onlyKinds={focus === "photos" ? ["image", "promotion"] : undefined}
          onlyPageIds={focus === "contact" ? ["contact", "pricing"] : undefined}
        />
      </div>
    );
  }

  if (view === "review") {
    const review = await getDraftReview(facts);
    return (
      <div className="max-w-5xl">
        <PageHeader title="Review and publish" description="This is exactly what will change on the live website." secondaryActions={back} />
        <ReviewPanel review={review} nowIso={nowIso} pagePaths={pagePaths} />
      </div>
    );
  }

  if (view === "history") {
    const [history, overview] = await Promise.all([listPublishedHistory(), getWebsiteOverview()]);
    return (
      <div className="max-w-4xl">
        <PageHeader title="Website history" description="Every version that has been live. Restoring one puts it in your draft first; it never goes live by itself." secondaryActions={back} />
        <HistoryPanel
          rows={history.map((item) => ({ id: item.id, version: item.version, live: item.id === overview.live?.id, when: when(item.publishedAt), by: item.publishedBy, note: item.note }))}
          draft={overview.draft ? { id: overview.draft.id, version: overview.draft.version, changes: overview.draft.changeCount } : null}
        />
      </div>
    );
  }

  const overview = await getWebsiteOverview();
  const tasks: { href: string; title: string; text: string }[] = [
    { href: "/desk/settings/website?view=edit", title: "Edit a page", text: "Change the words and buttons on any page, and see them as visitors will." },
    { href: "/desk/settings/website?view=edit&focus=photos", title: "Photos", text: "Upload pictures, choose what stays visible when cropped, and set up promotions." },
    { href: "/desk/settings/website?view=edit&focus=contact", title: "Contact & prices", text: "The wording on the quote form and the pricing page. The prices come from your price list." },
    { href: "/desk/settings/website?view=review", title: "Review & publish", text: overview.draft ? `${overview.draft.changeCount} ${overview.draft.changeCount === 1 ? "change is" : "changes are"} waiting. Check them, then publish.` : "Nothing is waiting to be published." },
  ];
  return (
    <div className="max-w-5xl">
      <PageHeader title="Website" description="Change what visitors read and see on your public website. Nothing reaches them until you publish." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Live now">
          {overview.live ? (
            <p className="text-sm text-ink">Version {overview.live.version}, published {when(overview.live.publishedAt)}{overview.live.publishedBy ? ` by ${overview.live.publishedBy}` : ""}.</p>
          ) : (
            <p className="text-sm text-ink">Visitors see the recommended starting wording. You have not published a change yet.</p>
          )}
        </Card>
        <Card title="Your draft">
          {overview.draft ? (
            <p className="text-sm text-ink">{overview.draft.changeCount} {overview.draft.changeCount === 1 ? "change" : "changes"} not yet published. Last saved {when(overview.draft.savedAt)}.</p>
          ) : (
            <p className="text-sm text-ink">No unpublished changes.</p>
          )}
        </Card>
      </div>
      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {tasks.map((task) => (
          <li key={task.href}>
            <Link href={task.href} className="block h-full min-h-11 rounded-card border border-line bg-surface p-4 hover:bg-subtle sm:p-6">
              <span className="text-lg font-semibold text-ink">{task.title}</span>
              <span className="mt-1 block text-sm text-ink-soft">{task.text}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-ink-soft">
        <Link className="underline" href="/desk/settings/website?view=history">History and restore</Link> ({overview.versionsPublished} {overview.versionsPublished === 1 ? "version" : "versions"} published).
        Phone, email, address, service area and prices are not edited here; they come from <Link className="underline" href="/desk/settings">Settings</Link> and your price list.
      </p>
    </div>
  );
}
