"use client";

import { useEffect, useState } from "react";
import { formatBusinessTime } from "@/lib/business-date";
import { readRouteSnapshot, type RouteSnapshotData } from "@/lib/route-snapshot";

/**
 * AR-5 section 5: when this device holds a saved copy of today's route for
 * the person signed in on it (the "desk-user" sessionStorage stamp the app
 * frame writes), show it read-only under the plain offline message.
 * Directions and Call are plain links and keep working; every action that
 * changes something stays hidden behind the paused line. No valid snapshot
 * (another person, another day, storage refused) renders nothing at all.
 */
export function OfflineRoute() {
  const [snapshot, setSnapshot] = useState<RouteSnapshotData | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const userId = sessionStorage.getItem("desk-user");
        if (!userId) return;
        const data = await readRouteSnapshot(userId);
        if (live && data) setSnapshot(data);
      } catch {
        /* storage denied: plain offline page */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!snapshot) return null;
  const savedTime = formatBusinessTime(new Date(snapshot.savedAt));

  return (
    <section aria-label="Today's saved route" className="w-full text-left">
      <h2 className="text-lg font-extrabold text-ink">
        Today&apos;s route (saved {savedTime}) — you&apos;re offline
      </h2>
      <p className="mt-1 text-sm text-ink-soft">Changes are paused until you&apos;re back online.</p>
      <div className="mt-4 space-y-3">
        {snapshot.stops.map((stop, i) => (
          <article key={stop.id} className="rounded-card border border-line bg-white p-4">
            <p className="text-sm font-bold text-ink">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-subtle text-xs font-extrabold">
                {i + 1}
              </span>
              {stop.time} · {stop.typeLabel}
            </p>
            <p className="mt-1 text-sm font-semibold text-ink">{stop.customerName}</p>
            {stop.unit && <p className="text-sm text-ink-soft">{stop.unit}</p>}
            {stop.addressLine && <p className="text-sm text-ink-soft">{stop.addressLine}</p>}
            {stop.appliances.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-sm text-ink">
                {stop.appliances.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            )}
            {stop.notes && <p className="mt-1 text-sm text-ink">{stop.notes}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {stop.addressLine && (
                <a
                  className="inline-flex min-h-11 items-center rounded-field border border-line bg-white px-4 py-2 text-sm font-bold text-ink"
                  href={`https://maps.google.com/?q=${encodeURIComponent(stop.addressLine)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Directions
                </a>
              )}
              {stop.phone && (
                <a
                  className="inline-flex min-h-11 items-center rounded-field border border-line bg-white px-4 py-2 text-sm font-bold text-ink"
                  href={`tel:${stop.phone}`}
                >
                  Call
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
