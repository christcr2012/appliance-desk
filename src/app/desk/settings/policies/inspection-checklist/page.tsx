import Link from "next/link";
import { requireRole } from "@/lib/session";
import { PageHeader, SectionCard, secondaryActionClass } from "@/components/desk/workspace";
import { listChecklistVersions } from "@/domains/inventory/checklist-versions";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { ChecklistEditor } from "./checklist-editor";

export const metadata = { title: "Return inspection checklist", robots: { index: false, follow: false } };

export default async function InspectionChecklistPage() {
  await requireRole("OWNER", "ADMIN");
  const versions = await listChecklistVersions();
  const current = versions[0];
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Return inspection checklist"
        description="The questions answered when equipment comes back before it can be rented again."
        secondaryActions={
          <Link className={secondaryActionClass} href="/desk/settings?section=policies">
            Back to rental policies
          </Link>
        }
      />
      <SectionCard title="How this works">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li>Publishing creates a new version. Old versions are never edited or deleted.</li>
          <li>Inspections already recorded keep the exact questions they were answered against.</li>
          <li>Only inspections recorded after you publish use the new questions. A person who had the old checklist open is told to reload.</li>
          <li>Recommended starting point: keep the list short enough that it is actually checked every time.</li>
        </ul>
      </SectionCard>
      <div className="mt-6">
        {current ? (
          <SectionCard title={`Current checklist (version ${current.version})`}>
            <ChecklistEditor currentVersion={current.version} startingItems={current.items} />
          </SectionCard>
        ) : (
          <p className="text-sm text-gray-600">No checklist has been published yet.</p>
        )}
      </div>
      <section className="mt-6" aria-labelledby="checklist-history">
        <h2 id="checklist-history" className="text-lg font-semibold text-gray-900">
          History
        </h2>
        <ul className="mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {versions.map((v) => (
            <li key={v.id} className="px-4 py-3 text-sm">
              <p className="font-medium text-gray-900">
                Version {v.version}
                {v === current ? " — in use now" : ""} · {formatBusinessDate(v.publishedAt)} · {formatBusinessTime(v.publishedAt)}
                {v.publishedBy ? ` · by ${v.publishedBy}` : " · built-in starting list"}
              </p>
              <ol className="mt-1 list-decimal pl-5 text-ink-soft">
                {v.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
