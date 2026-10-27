import Link from "next/link";

import {
  deliveryTaxReadiness,
  listCheckableAddresses,
  listDeliveryAreaPlaces,
  listLicenseRecordOptions,
} from "@/domains/tax/delivery-readiness";
import { businessDateKey } from "@/lib/business-date";
import { requireRole } from "@/lib/session";
import { TaxActionForm } from "../setup/forms";
import { saveReadinessAction } from "./actions";

const formatRate = (v: number | null) =>
  v === null ? "No rate on file" : `${(v / 1000).toFixed(3)}%`;

const TAXES_LABEL: Record<string, string> = {
  TAXABLE: "Yes",
  EXEMPT: "No",
  UNDECIDED: "Not decided",
};

const LICENSE_LABEL: Record<string, string> = {
  NONE: "No license needed",
  AFTER_FIRST_DELIVERY: "After the first delivery",
  AFTER_SECOND_DELIVERY_IN_12_MONTHS: "After more than one delivery in 12 months",
  ALWAYS: "Yes, before delivering",
  UNKNOWN: "Not checked",
};

const CHANNEL_LABEL: Record<string, string> = {
  SUTS: "SUTS",
  CITY_PORTAL: "City portal",
  STATE_RETURN: "State return",
  UNKNOWN: "Not recorded",
};

type Query = { check?: string; city?: string };

export default async function DeliveryAreaPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const session = await requireRole("OWNER", "ADMIN");
  const owner = session.user.role === "OWNER";
  const query = await searchParams;

  const [places, licenseRecords, addresses] = await Promise.all([
    listDeliveryAreaPlaces(),
    owner ? listLicenseRecordOptions() : Promise.resolve([]),
    listCheckableAddresses(),
  ]);

  let addressResult: Awaited<ReturnType<typeof deliveryTaxReadiness>> | null = null;
  let checkedAddressLabel = "";
  if (query.check) {
    const address = addresses.find((row) => row.id === query.check);
    if (address) {
      checkedAddressLabel = `${address.line1}, ${address.city}, ${address.state} ${address.zip}`;
      addressResult = await deliveryTaxReadiness(address.id);
    }
  }
  const cityQuery = query.city?.trim().toLowerCase();
  const cityPlace = cityQuery
    ? places.find((place) => place.name.toLowerCase() === cityQuery)
    : undefined;

  return (
    <main className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold">Delivery area</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          A delivery address can only be quoted, ordered and scheduled when
          every taxing place for it is set up here: its rental tax rule is
          decided, and where the city requires a license, the license is on
          file in{" "}
          <Link href="/desk/paperwork" className="underline">
            Business records
          </Link>
          . Places outside this list work the same way — the first address
          there shows up as “not set up” until it is reviewed here.
        </p>
      </div>

      <section aria-labelledby="check-heading" className="space-y-3">
        <h3 id="check-heading" className="font-semibold">
          Check an address
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <form method="get" className="space-y-2 rounded-xl border border-border bg-card p-4">
            <label htmlFor="check-address" className="block text-sm font-medium">
              A customer address on file
            </label>
            <select
              id="check-address"
              name="check"
              defaultValue={query.check ?? ""}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            >
              <option value="">Choose an address…</option>
              {addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.line1}, {address.city} —{" "}
                  {address.customer.user.name ?? address.customer.user.email}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background"
            >
              Check this address
            </button>
          </form>
          <form method="get" className="space-y-2 rounded-xl border border-border bg-card p-4">
            <label htmlFor="check-city" className="block text-sm font-medium">
              A city or town by name
            </label>
            <input
              id="check-city"
              name="city"
              type="text"
              defaultValue={query.city ?? ""}
              placeholder="e.g. Fort Collins"
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background"
            >
              Check this place
            </button>
          </form>
        </div>

        {query.check && (
          <div role="status" className="rounded-xl border border-border bg-card p-4 text-sm">
            {addressResult ? (
              addressResult.ready ? (
                <p>
                  <strong>{checkedAddressLabel}</strong> — ready to deliver.
                  Every taxing place for this address is set up.
                </p>
              ) : (
                <>
                  <p>
                    <strong>{checkedAddressLabel}</strong> — not ready to
                    deliver yet:
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {addressResult.places
                      .filter((place) => place.problem)
                      .map((place) => (
                        <li key={place.name}>{place.problem?.message}</li>
                      ))}
                  </ul>
                </>
              )
            ) : (
              <p>That address is no longer on file.</p>
            )}
          </div>
        )}
        {cityQuery && (
          <div role="status" className="rounded-xl border border-border bg-card p-4 text-sm">
            {cityPlace ? (
              cityPlace.problem ? (
                <p>
                  <strong>{cityPlace.name}</strong> — not ready yet:{" "}
                  {cityPlace.problem}
                </p>
              ) : (
                <p>
                  <strong>{cityPlace.name}</strong> — ready to deliver. Its
                  rules are decided and any license it requires is on file.
                </p>
              )
            ) : (
              <p>
                No place named “{query.city}” is on the list yet. A place
                joins the list when an address there is confirmed, and it
                starts as not set up.
              </p>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="places-heading" className="space-y-3">
        <h3 id="places-heading" className="font-semibold">
          Places within 50 miles of Greeley, and any place an address has reached
        </h3>
        <div
          tabIndex={0}
          role="region"
          aria-label="Delivery area places"
          className="overflow-x-auto rounded-xl border border-border"
        >
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th scope="col" className="px-3 py-2 font-medium">Place</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Rate</th>
                <th scope="col" className="px-3 py-2 font-medium">Taxes rentals?</th>
                <th scope="col" className="px-3 py-2 font-medium">License</th>
                <th scope="col" className="px-3 py-2 font-medium">Files through</th>
                <th scope="col" className="px-3 py-2 font-medium">Source &amp; checked</th>
                <th scope="col" className="px-3 py-2 font-medium">Review</th>
                {owner && <th scope="col" className="px-3 py-2 font-medium">Edit</th>}
              </tr>
            </thead>
            <tbody>
              {places.map((place) => (
                <tr key={place.jurisdictionId} className="border-b border-border align-top">
                  <td className="px-3 py-2 font-medium">{place.name}</td>
                  <td className="px-3 py-2">
                    {place.problem ? (
                      <span className="text-destructive">{place.problem}</span>
                    ) : (
                      <span>Ready</span>
                    )}
                    {place.deliveriesLast12Months > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {place.deliveriesLast12Months} deliver
                        {place.deliveriesLast12Months === 1 ? "y" : "ies"} in the last 12 months
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{formatRate(place.rateMilliPercent)}</td>
                  <td className="px-3 py-2">
                    {place.taxesRentals ? TAXES_LABEL[place.taxesRentals] : "State-collected"}
                  </td>
                  <td className="px-3 py-2">
                    {place.licenseRequired ? LICENSE_LABEL[place.licenseRequired] : "—"}
                    {place.licenseRecord && (
                      <span className="block text-xs text-muted-foreground">
                        On file: {place.licenseRecord.title}
                        {place.licenseRecord.expiresOn
                          ? ` (expires ${businessDateKey(place.licenseRecord.expiresOn)})`
                          : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {place.filesThrough ? CHANNEL_LABEL[place.filesThrough] : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {place.sourceUrl ? (
                      <a href={place.sourceUrl} className="underline" rel="noreferrer" target="_blank">
                        City page
                      </a>
                    ) : (
                      "Research table"
                    )}
                    {place.checkedOn && (
                      <span className="block text-xs text-muted-foreground">
                        Checked {businessDateKey(place.checkedOn)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {place.reviewStatus === "REVIEWED" ? "Reviewed" : "Needs review"}
                  </td>
                  {owner && (
                    <td className="px-3 py-2">
                      <details>
                        <summary className="cursor-pointer underline">Edit</summary>
                        <div className="mt-2 min-w-[280px]">
                          <TaxActionForm
                            action={saveReadinessAction}
                            title={`Set up ${place.name}`}
                            submitLabel="Save readiness"
                          >
                            <input type="hidden" name="jurisdictionId" value={place.jurisdictionId} />
                            {place.administration === "SELF_COLLECTED" && (
                              <p className="text-sm text-muted-foreground">
                                Taxes rentals:{" "}
                                {place.taxesRentals ? TAXES_LABEL[place.taxesRentals] : "Not decided"}.
                                That decision lives on{" "}
                                <a href="/desk/sales-tax/taxability" className="underline">
                                  Taxes › What gets taxed
                                </a>{" "}
                                — this screen only tracks the license and filing setup.
                              </p>
                            )}
                            <label className="block text-sm">
                              City license needed?
                              <select
                                name="licenseRequired"
                                defaultValue={place.licenseRequired ?? "UNKNOWN"}
                                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
                              >
                                <option value="ALWAYS">Yes, before delivering</option>
                                <option value="AFTER_FIRST_DELIVERY">After the first delivery</option>
                                <option value="AFTER_SECOND_DELIVERY_IN_12_MONTHS">
                                  After more than one delivery in 12 months
                                </option>
                                <option value="NONE">No license needed</option>
                                <option value="UNKNOWN">Not checked</option>
                              </select>
                            </label>
                            <label className="block text-sm">
                              License on file (Business records)
                              <select
                                name="licenseRecordId"
                                defaultValue={place.licenseRecord?.id ?? ""}
                                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
                              >
                                <option value="">None linked</option>
                                {licenseRecords.map((record) => (
                                  <option key={record.id} value={record.id}>
                                    {record.title}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-sm">
                              How are returns filed?
                              <select
                                name="filesThrough"
                                defaultValue={place.filesThrough ?? "UNKNOWN"}
                                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
                              >
                                <option value="SUTS">SUTS</option>
                                <option value="CITY_PORTAL">City portal</option>
                                <option value="STATE_RETURN">State return</option>
                                <option value="UNKNOWN">Not recorded</option>
                              </select>
                            </label>
                            <label className="block text-sm">
                              Source page (where the rules came from)
                              <input
                                type="url"
                                name="sourceUrl"
                                defaultValue={place.sourceUrl ?? ""}
                                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
                              />
                            </label>
                            <label className="block text-sm">
                              Notes
                              <textarea
                                name="notes"
                                rows={3}
                                defaultValue={place.notes ?? ""}
                                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
                              />
                            </label>
                            <label className="flex items-start gap-2 text-sm">
                              <input type="checkbox" name="markReviewed" value="yes" className="mt-1" />
                              <span>I checked this place against its own page or office — mark it reviewed.</span>
                            </label>
                          </TaxActionForm>
                        </div>
                      </details>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
