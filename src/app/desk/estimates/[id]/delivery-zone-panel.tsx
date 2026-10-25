import { readZoneSnapshot, zoneSentence, formatMiles, chosenDeliveryCents } from "@/domains/delivery/snapshot";
import { zonePriceWords } from "@/domains/delivery/zone";
import { checkZoneAction, confirmZoneMilesAction, pickupArrangedAction, setZoneChoiceAction } from "./zone-actions";

const CHECKABLE = new Set(["DRAFT", "CHANGES_REQUESTED"]);
const CHOOSABLE = new Set(["DRAFT", "CHANGES_REQUESTED", "SENT", "VIEWED", "APPROVED"]);
const button = "min-h-11 rounded-control border border-line-strong px-3 text-sm font-semibold text-ink";
const field = "mt-1 min-h-11 w-full rounded-control border border-control bg-surface px-3 py-2 text-ink";

const METHOD_WORDS = { STRAIGHT_LINE: "straight line from the center", DRIVING: "driving distance", STAFF_MILES: "miles typed by staff" } as const;

/**
 * ZONE-1 on the desk estimate page: the zone found for each delivery address, its price, the delivery or pickup choice,
 * and the fixes for an unknown zone. Plain forms: works without JavaScript.
 */
export function DeliveryZonePanel({ estimate, addresses, note, error }: {
  estimate: { id: string; status: string; deliveryZoneSnapshot: unknown; deliveryZoneSnapshotAt: Date | null };
  addresses: { id: string; label: string }[];
  note?: string; error?: string;
}) {
  const snapshot = readZoneSnapshot(estimate.deliveryZoneSnapshot);
  const canCheck = CHECKABLE.has(estimate.status);
  const canChoose = CHOOSABLE.has(estimate.status);
  return (
    <section id="delivery-zone" aria-labelledby="delivery-zone-heading" className="mt-6 rounded-card border border-line bg-surface p-4">
      <h2 id="delivery-zone-heading" className="text-base font-bold">Delivery zone</h2>
      {note && <p role="status" className="mt-2 text-sm font-semibold text-success">{note}</p>}
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-danger">{error}</p>}
      {!addresses.length && <p className="mt-2 text-sm text-ink-soft">Add a line with a delivery address to find its zone.</p>}
      {addresses.length > 0 && !snapshot && (
        <p className="mt-2 text-sm text-ink-soft">The delivery zone hasn&apos;t been checked yet.</p>
      )}
      <ul className="mt-3 space-y-4">
        {addresses.map((address) => {
          const location = snapshot?.locations.find((row) => row.serviceAddressId === address.id);
          if (!location) return (
            <li key={address.id} className="text-sm"><p className="font-semibold">{address.label}</p><p className="text-ink-soft">Not checked yet.</p></li>
          );
          const chosen = chosenDeliveryCents(location);
          return (
            <li key={address.id} className="rounded-card border border-line p-3 text-sm">
              <p className="font-semibold">{address.label}</p>
              <p className="mt-1">{zoneSentence(location)}</p>
              <p className="mt-1 text-ink-soft">
                {location.miles !== null ? `${formatMiles(location.miles)}, ${METHOD_WORDS[location.method]}. ` : ""}
                {location.pickupPriceCents !== null ? `Our pickup at the end of the rental: ${zonePriceWords(location.pickupPriceCents)}. ` : ""}
                {location.confirmed ? `Confirmed by hand: ${location.confirmed.reason}` : ""}
              </p>
              <p className="mt-1 font-semibold">
                {location.choice === "DELIVER"
                  ? `Chosen: we deliver (${chosen === null ? "price to be confirmed" : zonePriceWords(chosen)})`
                  : "Chosen: customer picks it up ($0)"}
              </p>
              {location.choice === "CUSTOMER_PICKUP" && location.requote && (
                <p role="alert" className="mt-1 font-semibold text-warning-ink">
                  New quote needed: the reviewed quote charged delivery. Remove the delivery charge in the service-fee
                  review, then send the estimate again. Until then it can&apos;t be approved.
                </p>
              )}
              {location.choice === "CUSTOMER_PICKUP" && (
                <p className="mt-1 text-ink-soft">
                  {location.pickupArranged ? `Pickup plan: ${location.pickupArranged.note}`
                    : "The customer moves it: they need a suitable vehicle and help. Installation is offered separately (never self-install for gas appliances)."}
                </p>
              )}
              {canChoose && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {location.zone !== "OUTSIDE" && location.choice !== "DELIVER" && (
                    <form action={setZoneChoiceAction}>
                      <input type="hidden" name="estimateId" value={estimate.id} />
                      <input type="hidden" name="serviceAddressId" value={address.id} />
                      <input type="hidden" name="choice" value="DELIVER" />
                      <button className={button}>Deliver it{location.priceCents !== null ? ` (${zonePriceWords(location.priceCents)})` : ""}</button>
                    </form>
                  )}
                  {location.choice !== "CUSTOMER_PICKUP" && (
                    <form action={setZoneChoiceAction}>
                      <input type="hidden" name="estimateId" value={estimate.id} />
                      <input type="hidden" name="serviceAddressId" value={address.id} />
                      <input type="hidden" name="choice" value="CUSTOMER_PICKUP" />
                      <button className={button}>Customer picks it up ($0)</button>
                    </form>
                  )}
                </div>
              )}
              {location.zone === "UNKNOWN" && canChoose && (
                <form action={confirmZoneMilesAction} className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
                  <p className="text-ink-soft sm:col-span-3">{location.unknownReason}</p>
                  <input type="hidden" name="estimateId" value={estimate.id} />
                  <input type="hidden" name="serviceAddressId" value={address.id} />
                  <label className="block font-semibold">Miles
                    <input name="miles" type="number" min="0" max="500" step="0.1" required className={field} />
                  </label>
                  <label className="block font-semibold">How you measured it
                    <input name="reason" minLength={5} maxLength={300} required className={field} placeholder="e.g. measured on a map from the center" />
                  </label>
                  <button className={button}>Confirm zone</button>
                </form>
              )}
              {location.choice === "CUSTOMER_PICKUP" && !location.pickupArranged && (
                <form action={pickupArrangedAction} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                  <input type="hidden" name="estimateId" value={estimate.id} />
                  <input type="hidden" name="serviceAddressId" value={address.id} />
                  <label className="block font-semibold">Pickup date, time and place
                    <input name="note" minLength={5} maxLength={300} required className={field} />
                  </label>
                  <button className={button}>Save pickup plan</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {canCheck && addresses.length > 0 && (
        <form action={checkZoneAction} className="mt-4">
          <input type="hidden" name="estimateId" value={estimate.id} />
          <button className={button}>{snapshot ? "Check the zone again" : "Find the delivery zone"}</button>
        </form>
      )}
      {!canCheck && snapshot && <p className="mt-3 text-xs text-ink-soft">The estimate was sent, so its zone and prices are frozen.</p>}
    </section>
  );
}
