import { getAllPartRecords } from "@/domains/inventory";

export const metadata = { title: "Parts" };

/**
 * A searchable-by-eye list of every part Chris has ever logged, across all
 * models — useful when he's fixing a DIFFERENT unit of a model he's already
 * looked up a part for, without having to find that original unit first.
 * See the per-model version on an appliance's own detail page for adding
 * new parts.
 */
export default async function PartsPage() {
  const partRecords = await getAllPartRecords();

  return (
    <div>
      <h1 className="text-xl font-semibold">Parts</h1>
      <p className="mt-1 text-sm text-gray-600">
        Every part you&apos;ve logged, by model number. To add a new one, go
        to an appliance of that model and use the &ldquo;Parts for this
        model&rdquo; section on its page.
      </p>

      {partRecords.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          No parts logged yet — they&apos;ll show up here once you save one
          from an appliance&apos;s page.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {partRecords.map((p) => (
            <li key={p.id} className="px-4 py-4">
              <p className="font-medium text-gray-900">
                {p.modelNumber}
                {p.manufacturer ? ` (${p.manufacturer})` : ""}
                {p.applianceType ? ` — ${p.applianceType.name}` : ""}
              </p>
              <p className="text-sm text-gray-700">
                Part {p.partNumber}
                {p.partName ? ` — ${p.partName}` : ""}
              </p>
              {p.notes && <p className="text-sm text-gray-600">{p.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
