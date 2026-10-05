import Link from "next/link";
import { requireRole } from "@/lib/session";
import { listChecklistVersions } from "@/domains/inventory/checklist-versions";
import { getBusinessSettings } from "@/domains/settings";
import {
  LEGAL_PAGE_VERSIONS,
  parseLegalApprovals,
  type LegalPage,
} from "@/domains/settings/legal-approvals";
import { formatBusinessDate } from "@/lib/business-date";
import { approveLegalPageAction, publishChecklistAction } from "./actions";

export const metadata = { title: "Rental policies" };

const LEGAL_PAGES: Array<{ page: LegalPage; label: string; href: string }> = [
  { page: "privacy", label: "Privacy Policy", href: "/privacy" },
  { page: "terms", label: "Terms of Use", href: "/terms" },
];

export default async function InspectionChecklistSettingsPage() {
  const session = await requireRole("OWNER", "ADMIN");
  const [versions, settings] = await Promise.all([
    listChecklistVersions(),
    getBusinessSettings(),
  ]);
  const current = versions[0];
  const currentItems = current && Array.isArray(current.items) ? (current.items as string[]) : [];
  const approvals = parseLegalApprovals(
    (settings as { legalApprovals?: unknown }).legalApprovals,
  );
  const canApproveLegal = session.user.role === "OWNER";

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link href="/desk/settings?section=policies" className="text-sm text-primary underline">
          ← Rental policies
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Rental policies</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Version operational checklists and record owner approval of the exact legal-page versions that may be treated as final.
        </p>
      </div>

      <section aria-labelledby="legal-approval-heading" className="rounded-lg border border-line bg-surface p-5">
        <h2 id="legal-approval-heading" className="text-lg font-semibold text-ink">Legal page approval</h2>
        <p className="mt-1 text-sm text-ink-soft">
          This records that the owner approved the exact text version shown. It is an internal publication record, not legal advice or a substitute for legal review.
        </p>
        <div className="mt-4 space-y-4">
          {LEGAL_PAGES.map(({ page, label, href }) => {
            const currentVersion = LEGAL_PAGE_VERSIONS[page];
            const approved = approvals[page];
            const currentApproved = approved?.version === currentVersion;
            return (
              <article key={page} className="rounded-lg border border-line bg-subtle p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-ink">{label}</h3>
                    <p className="mt-1 text-sm text-ink-soft">Current version: {currentVersion}</p>
                    {currentApproved ? (
                      <p className="mt-1 text-sm text-ink-soft">
                        Approved {formatBusinessDate(new Date(approved.approvedOn))} by {approved.approvedBy}.
                      </p>
                    ) : approved ? (
                      <p className="mt-1 text-sm text-ink-soft">
                        Previous approval was for version {approved.version}; this newer version remains draft/noindex.
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-ink-soft">Not approved. The page remains draft/noindex and is omitted from final legal links.</p>
                    )}
                  </div>
                  <Link href={href} className="text-sm text-primary underline">Review page</Link>
                </div>
                {!currentApproved && canApproveLegal && (
                  <form action={approveLegalPageAction} className="mt-3">
                    <input type="hidden" name="page" value={page} />
                    <button type="submit" className="min-h-11 rounded-lg bg-action px-4 py-2 font-medium text-on-action">
                      Record owner approval of version {currentVersion}
                    </button>
                  </form>
                )}
                {!canApproveLegal && !currentApproved && (
                  <p className="mt-3 text-xs text-ink-faint">Only the OWNER account can record legal-page approval.</p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="checklist-editor-heading">
        <h2 id="checklist-editor-heading" className="text-lg font-semibold text-ink">Return inspection checklist</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Publish the checklist used when appliances come back. A new version only affects inspections from now on; completed inspections keep the exact checklist they used.
        </p>
        <form action={publishChecklistAction} className="mt-3 rounded-lg border border-line bg-surface p-5">
          <label htmlFor="items" className="font-medium text-ink">Checklist items</label>
          <p className="mt-1 text-sm text-ink-soft">One item per line. Use 1–40 unique items, 2–200 characters each.</p>
          <textarea
            id="items"
            name="items"
            rows={Math.max(10, currentItems.length + 2)}
            defaultValue={currentItems.join("\n")}
            className="mt-3 w-full rounded-lg border border-control bg-surface px-3 py-2 text-ink"
            required
          />
          <button type="submit" className="mt-3 min-h-11 rounded-lg bg-action px-4 py-2 font-medium text-on-action">
            Publish new checklist version
          </button>
        </form>
      </section>

      <section aria-labelledby="checklist-history-heading">
        <h2 id="checklist-history-heading" className="text-lg font-semibold text-ink">Checklist version history</h2>
        <div className="mt-3 space-y-3">
          {versions.map((version, index) => (
            <article key={version.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium text-ink">Version {version.version}{index === 0 ? " — current" : ""}</h3>
                <span className="text-sm text-ink-soft">Published {formatBusinessDate(version.publishedAt)}</span>
              </div>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
                {(version.items as string[]).map((item, itemIndex) => (
                  <li key={`${version.id}-${itemIndex}`}>{item}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
