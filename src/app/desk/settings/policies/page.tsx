import Link from "next/link";
import { requireRole } from "@/lib/session";
import { listChecklistVersions } from "@/domains/inventory/checklist-versions";
import { formatBusinessDate } from "@/lib/business-date";
import { publishChecklistAction } from "./actions";

export const metadata = { title: "Inspection checklist" };

export default async function InspectionChecklistSettingsPage() {
  await requireRole("OWNER", "ADMIN");
  const versions = await listChecklistVersions();
  const current = versions[0];
  const currentItems = current && Array.isArray(current.items) ? (current.items as string[]) : [];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/desk/settings?section=policies" className="text-sm text-primary underline">
          ← Rental policies
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Return inspection checklist</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Publish the checklist used when appliances come back. A new version only affects inspections from now on;
          completed inspections keep the exact checklist they used.
        </p>
      </div>

      <form action={publishChecklistAction} className="rounded-lg border border-line bg-surface p-5">
        <label htmlFor="items" className="font-medium text-ink">
          Checklist items
        </label>
        <p className="mt-1 text-sm text-ink-soft">
          One item per line. Use 1–40 unique items, 2–200 characters each.
        </p>
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

      <section aria-labelledby="checklist-history-heading">
        <h2 id="checklist-history-heading" className="text-lg font-semibold text-ink">
          Version history
        </h2>
        <div className="mt-3 space-y-3">
          {versions.map((version, index) => (
            <article key={version.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium text-ink">
                  Version {version.version}{index === 0 ? " — current" : ""}
                </h3>
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
