import { requireRole } from "@/lib/session";
import { listChecklistVersions } from "@/domains/inventory/checklist-versions";
import { getBusinessSettings } from "@/domains/settings";
import {
  LEGAL_PAGE_VERSIONS,
  parseLegalApprovals,
  type LegalPage,
} from "@/domains/settings/legal-approvals";
import { formatBusinessDate } from "@/lib/business-date";
import {
  Button,
  ButtonLink,
  Card,
  PageHeader,
  StatusPill,
  Textarea,
} from "@/components/ui";
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
  const currentItems =
    current && Array.isArray(current.items)
      ? (current.items as string[])
      : [];
  const approvals = parseLegalApprovals(
    (settings as { legalApprovals?: unknown }).legalApprovals,
  );
  const canApproveLegal = session.user.role === "OWNER";

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Rental policies"
        description="Version operational checklists and record owner approval of the exact legal-page versions that may be treated as final."
        secondaryActions={
          <ButtonLink href="/desk/settings?section=policies" variant="secondary">
            Rental policies
          </ButtonLink>
        }
      />

      <div className="space-y-6">
        <Card
          title="Legal page approval"
          description="This records that the owner approved the exact text version shown. It is an internal publication record, not legal advice or a substitute for legal review."
        >
          <div className="space-y-4">
            {LEGAL_PAGES.map(({ page, label, href }) => {
              const currentVersion = LEGAL_PAGE_VERSIONS[page];
              const approved = approvals[page];
              const currentApproved = approved?.version === currentVersion;

              return (
                <section
                  key={page}
                  className="rounded-card border border-line bg-subtle p-4"
                  aria-labelledby={`legal-page-${page}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3
                          id={`legal-page-${page}`}
                          className="font-semibold text-ink"
                        >
                          {label}
                        </h3>
                        <StatusPill
                          tone={
                            currentApproved
                              ? "success"
                              : approved
                                ? "attention"
                                : "pending"
                          }
                          label={
                            currentApproved
                              ? "Approved"
                              : approved
                                ? "Newer version needs approval"
                                : "Not approved"
                          }
                        />
                      </div>
                      <p className="mt-2 text-sm text-ink-soft">
                        Current version: {currentVersion}
                      </p>
                      {currentApproved ? (
                        <p className="mt-1 text-sm text-ink-soft">
                          Approved{" "}
                          {formatBusinessDate(
                            new Date(approved.approvedOn),
                          )}{" "}
                          by {approved.approvedBy}.
                        </p>
                      ) : approved ? (
                        <p className="mt-1 text-sm text-ink-soft">
                          Previous approval was for version {approved.version};
                          this newer version remains draft/noindex.
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-ink-soft">
                          Not approved. The page remains draft/noindex and is
                          omitted from final legal links.
                        </p>
                      )}
                    </div>

                    <ButtonLink href={href} variant="secondary">
                      Review page
                    </ButtonLink>
                  </div>

                  {!currentApproved && canApproveLegal && (
                    <form action={approveLegalPageAction} className="mt-4">
                      <input type="hidden" name="page" value={page} />
                      <Button type="submit">
                        Record owner approval of version {currentVersion}
                      </Button>
                    </form>
                  )}

                  {!canApproveLegal && !currentApproved && (
                    <p className="mt-3 text-xs text-ink-faint">
                      Only the OWNER account can record legal-page approval.
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        </Card>

        <Card
          title="Return inspection checklist"
          description="Publish the checklist used when appliances come back. A new version only affects inspections from now on; completed inspections keep the exact checklist they used."
        >
          <form action={publishChecklistAction} className="space-y-4">
            <Textarea
              id="items"
              name="items"
              label="Checklist items"
              help="One item per line. Use 1–40 unique items, 2–200 characters each."
              rows={Math.max(10, currentItems.length + 2)}
              defaultValue={currentItems.join("\n")}
              required
            />
            <Button type="submit">Publish new checklist version</Button>
          </form>
        </Card>

        <Card
          title="Checklist version history"
          description="Completed inspections keep the exact checklist version they used."
        >
          <div className="space-y-3">
            {versions.map((version, index) => (
              <section
                key={version.id}
                className="rounded-card border border-line bg-subtle p-4"
                aria-labelledby={`checklist-version-${version.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3
                    id={`checklist-version-${version.id}`}
                    className="font-semibold text-ink"
                  >
                    Version {version.version}
                    {index === 0 ? " — current" : ""}
                  </h3>
                  <span className="text-sm text-ink-soft">
                    Published {formatBusinessDate(version.publishedAt)}
                  </span>
                </div>
                <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
                  {(version.items as string[]).map((item, itemIndex) => (
                    <li key={`${version.id}-${itemIndex}`}>{item}</li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
