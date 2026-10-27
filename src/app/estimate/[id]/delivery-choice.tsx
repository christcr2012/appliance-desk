import { currentLocations, routeExceptionSentence, zoneSentence } from "@/domains/delivery/snapshot";
import { zonePriceWords } from "@/domains/delivery/zone";
import { chooseDeliveryAction } from "./zone-actions";
import type { CustomerDeliveryCharge } from "@/domains/orders/route-evidence";

const WAITING = new Set(["SENT", "VIEWED"]);
const RESULT_WORDS: Record<string, string> = {
  saved: "Your choice is saved.",
  limited: "Too many attempts; please try again later.",
  refused: "That choice couldn't be saved. The estimate may no longer be waiting for your answer.",
};

/**
 * ZONE-1 on the customer's estimate page: the zone for each delivery address and the choice between delivery and
 * "I'll pick it up". Shows only zone names, miles and prices from the frozen zone (never a map position). Plain forms.
 */
export function EstimateDeliveryChoice({ estimateId, status, snapshot: raw, addresses, result, charges = {} }: {
  estimateId: string; status: string; snapshot: unknown; addresses: { id: string; label: string }[]; result?: string;
  /** The delivery charge the quote must carry per address (route exceptions included); see customerDeliveryChargesForEstimate. */
  charges?: Record<string, CustomerDeliveryCharge>;
}) {
  // Only addresses still on the estimate (a removed line's address is never shown or offered).
  const locations = currentLocations(raw, addresses.map((row) => row.id));
  if (!locations.length) return null;
  const waiting = WAITING.has(status);
  const labels = new Map(addresses.map((row) => [row.id, row.label]));
  return (
    <section id="delivery-choice" aria-labelledby="delivery-choice-heading" className="mt-6 rounded-lg border border-line bg-surface p-5 text-sm">
      <h2 id="delivery-choice-heading" className="font-semibold">Delivery or pickup</h2>
      {result && RESULT_WORDS[result] && <p role="status" className="mt-2 font-semibold">{RESULT_WORDS[result]}</p>}
      <ul className="mt-3 space-y-4">
        {locations.map((location) => {
          const charge = charges[location.serviceAddressId];
          // The price shown is the one approval and signing will require: a route exception overrides the zone price.
          const deliverCents = charge ? charge.deliverCents : location.priceCents;
          const exception = Boolean(charge?.routeException) && deliverCents !== location.priceCents;
          return (
          <li key={location.serviceAddressId}>
            <p className="text-ink-faint">{labels.get(location.serviceAddressId) ?? ""}</p>
            <p className="mt-1">{charge && deliverCents === null && location.zone !== "OUTSIDE" ? "We'll confirm your delivery price." : exception ? routeExceptionSentence(location, deliverCents) : zoneSentence(location)}</p>
            <p className="mt-1 font-semibold">
              {location.choice === "DELIVER"
                ? `You chose delivery${deliverCents !== null ? ` (${zonePriceWords(deliverCents)})` : " (price to be confirmed)"}.`
                : "You chose to pick it up ($0). We'll arrange a time and place with you."}
            </p>
            {location.choice === "CUSTOMER_PICKUP" && (
              <p className="mt-1 text-ink-soft">
                You move the appliance yourself, so you&apos;ll need a suitable vehicle and help. Installation is offered
                separately. We still need the address where the appliance will be kept.
              </p>
            )}
            {location.choice === "CUSTOMER_PICKUP" && location.requote && (
              <p role="status" className="mt-1 font-semibold">
                Your quote included delivery, so we&apos;ll send you an updated quote without it before you approve.
              </p>
            )}
            {waiting && (
              <div className="mt-2 flex flex-wrap gap-2">
                {location.zone !== "OUTSIDE" && location.choice !== "DELIVER" && (
                  <form action={chooseDeliveryAction}>
                    <input type="hidden" name="estimateId" value={estimateId} />
                    <input type="hidden" name="serviceAddressId" value={location.serviceAddressId} />
                    <input type="hidden" name="choice" value="DELIVER" />
                    <button className="min-h-11 rounded border border-line px-3 font-medium">
                      Deliver it{deliverCents !== null ? ` (${zonePriceWords(deliverCents)})` : ""}
                    </button>
                  </form>
                )}
                {location.choice !== "CUSTOMER_PICKUP" && (
                  <form action={chooseDeliveryAction}>
                    <input type="hidden" name="estimateId" value={estimateId} />
                    <input type="hidden" name="serviceAddressId" value={location.serviceAddressId} />
                    <input type="hidden" name="choice" value="CUSTOMER_PICKUP" />
                    <button className="min-h-11 rounded border border-line px-3 font-medium">
                      I&apos;ll pick it up — we&apos;ll arrange a time and place ($0)
                    </button>
                  </form>
                )}
              </div>
            )}
          </li>
          );
        })}
      </ul>
    </section>
  );
}
