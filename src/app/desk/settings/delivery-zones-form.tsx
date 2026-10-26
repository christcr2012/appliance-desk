"use client";

import { useActionState } from "react";
import { saveDeliveryZonesAction, type ZoneFormState } from "./delivery-zone-actions";
import { ZONE_COLORS, ZONE_COLOR_WORDS, type ZoneSettings } from "@/domains/delivery/zone";
import { centsAsDollars } from "@/lib/money-ui";

const IDLE: ZoneFormState = { status: "idle" };
const dollars = (cents: number) => centsAsDollars(cents);
const input = "mt-1 min-h-11 w-full rounded-control border border-control bg-surface px-3 py-2 text-ink";

/** Settings › Delivery zones form. Prices in dollars on screen, saved as cents. Owner only (others see it read-only). */
export function DeliveryZonesForm({ settings, revision, canChange }: { settings: ZoneSettings; revision: string; canChange: boolean }) {
  const [state, action, pending] = useActionState(saveDeliveryZonesAction, IDLE);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="zoneCount" value={settings.zones.length} />
      <fieldset disabled={!canChange || pending} className="space-y-5">
        <legend className="sr-only">Delivery zones</legend>
        {settings.zones.map((zone, index) => (
          <fieldset key={index} className="rounded-card border border-line p-4">
            <legend className="px-1 text-sm font-bold text-ink">Zone {index + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="block text-sm font-semibold text-ink lg:col-span-2">Name customers see
                <input name={`name_${index}`} defaultValue={zone.name} maxLength={60} required className={input} />
              </label>
              <label className="block text-sm font-semibold text-ink">Up to (miles)
                <input name={`miles_${index}`} type="number" step="0.1" min="0.1" max="200" defaultValue={zone.outerMiles} required className={input} />
              </label>
              <label className="block text-sm font-semibold text-ink">Delivery price ($)
                <input name={`delivery_${index}`} type="number" step="0.01" min="0" defaultValue={dollars(zone.deliveryCents)} required className={input} />
              </label>
              <label className="block text-sm font-semibold text-ink">End-of-rental pickup ($)
                <input name={`pickup_${index}`} type="number" step="0.01" min="0" defaultValue={dollars(zone.pickupCents)} required className={input} />
              </label>
              <label className="block text-sm font-semibold text-ink">Map color
                <select name={`color_${index}`} defaultValue={zone.color} className={input}>
                  {ZONE_COLORS.map((color) => <option key={color} value={color}>{ZONE_COLOR_WORDS[color]}</option>)}
                </select>
              </label>
            </div>
          </fieldset>
        ))}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm font-semibold text-ink">Farthest delivery (miles)
            <input name="maxMiles" type="number" step="0.1" min="1" max="200" defaultValue={settings.maxMiles} required className={input} />
          </label>
          <label className="block text-sm font-semibold text-ink">Center latitude
            <input name="centerLat" type="number" step="any" min="-90" max="90" defaultValue={settings.center.lat} required className={input} />
          </label>
          <label className="block text-sm font-semibold text-ink">Center longitude
            <input name="centerLon" type="number" step="any" min="-180" max="180" defaultValue={settings.center.lon} required className={input} />
          </label>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">How distance is measured</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input type="radio" name="method" value="STRAIGHT_LINE" defaultChecked={settings.method === "STRAIGHT_LINE"} />
            Straight line from the center (automatic, the same circles the map shows)
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input type="radio" name="method" value="DRIVING" defaultChecked={settings.method === "DRIVING"} />
            Driving distance (you type the road miles for every address; no routing service is paid for)
          </label>
        </fieldset>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
          <input type="checkbox" name="showPrices" defaultChecked={settings.showPricesOnWebsite} />
          Show delivery prices on the website
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" name="operation" value="save" className="min-h-11 rounded-control bg-primary px-4 font-semibold text-on-primary">
            {pending ? "Saving…" : "Save delivery zones"}
          </button>
          <button type="submit" name="operation" value="restore" formNoValidate className="min-h-11 rounded-control border border-line-strong px-4 font-semibold text-ink">
            Restore recommended
          </button>
          <button type="submit" name="operation" value="shop" formNoValidate className="min-h-11 rounded-control border border-line-strong px-4 font-semibold text-ink">
            Use my shop address instead
          </button>
        </div>
      </fieldset>
      <div role="status" aria-live="polite" className="min-h-6 text-sm">
        {state.status === "saved" && <p className="font-semibold text-success">{state.message}</p>}
        {state.status === "error" && <p role="alert" className="font-semibold text-danger">{state.message}</p>}
      </div>
    </form>
  );
}
