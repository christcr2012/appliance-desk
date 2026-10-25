import { readZoneSnapshot, zoneSentence } from "@/domains/delivery/snapshot";
import { zonePriceWords } from "@/domains/delivery/zone";
import { chooseDeliveryAction } from "./zone-actions";

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
export function EstimateDeliveryChoice({ estimateId, status, snapshot: raw, addresses, result }: {
  estimateId: string; status: string; snapshot: unknown; addresses: { id: string; label: string }[]; result?: string;
}) {
  const snapshot = readZoneSnapshot(raw);
  if (!snapshot || !snapshot.locations.length) return null;
  const waiting = WAITING.has(status);
  const labels = new Map(addresses.map((row) => [row.id, row.label]));
  return (
    <section id="delivery-choice" aria-labelledby="delivery-choice-heading" className="mt-6 rounded-lg border border-line bg-surface p-5 text-sm">
      <h2 id="delivery-choice-heading" className="font-semibold">Delivery or pickup</h2>
      {result && RESULT_WORDS[result] && <p role="status" className="mt-2 font-semibold">{RESULT_WORDS[result]}</p>}
      <ul className="mt-3 space-y-4">
        {snapshot.locations.map((location) => (
          <li key={location.serviceAddressId}>
            <p className="text-ink-faint">{labels.get(location.serviceAddressId) ?? ""}</p>
            <p className="mt-1">{zoneSentence(location)}</p>
            <p className="mt-1 font-semibold">
              {location.choice === "DELIVER"
                ? `You chose delivery${location.priceCents !== null ? ` (${zonePriceWords(location.priceCents)})` : " (price to be confirmed)"}.`
                : "You chose to pick it up ($0). We'll arrange a time and place with you."}
            </p>
            {location.choice === "CUSTOMER_PICKUP" && (
              <p className="mt-1 text-ink-soft">
                You move the appliance yourself, so you&apos;ll need a suitable vehicle and help. Installation is offered
                separately. We still need the address where the appliance will be kept.
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
                      Deliver it{location.priceCents !== null ? ` (${zonePriceWords(location.priceCents)})` : ""}
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
        ))}
      </ul>
    </section>
  );
}
