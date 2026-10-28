"use client";

import { useActionState } from "react";
import { mileagePrompt } from "@/domains/vehicle/driver-prompt";
import { finishDayAction, startDayAction, type VehicleActionState } from "../vehicle/actions";

type Vehicle = { id: string; nickname: string; lastOdometer: number; trip: { id: string; startOdometer: number; endOdometer: number | null; miles: number | null } | null };

function OdometerForm({ action, label, submit, defaultValue }: { action: (prev: VehicleActionState, fd: FormData) => Promise<VehicleActionState>; label: string; submit: string; defaultValue: number }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as VehicleActionState);
  return (
    <form action={formAction} className="space-y-2">
      <label className="grid gap-1 text-sm font-medium">
        {label}
        <input name="odometer" type="number" inputMode="numeric" min={0} required defaultValue={defaultValue} className="min-h-11 rounded-control border border-line p-2" />
      </label>
      <button type="submit" disabled={pending} className="min-h-11 rounded-control bg-brand px-4 font-semibold text-white disabled:opacity-60">{pending ? "Saving…" : submit}</button>
      {state.status === "error" ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
      {state.status === "success" ? <p role="status" className="text-sm">{state.message}</p> : null}
    </form>
  );
}

/** Driver view: start-of-day and end-of-day odometer for the delivery vehicle. `stops` says how far along the route is. */
export function MileageCard({ vehicles, stops }: { vehicles: Vehicle[]; stops: { total: number; finished: number } }) {
  if (vehicles.length === 0) return null;
  return (
    <section aria-labelledby="mileage-heading" className="mb-4 space-y-4 rounded-lg border border-line bg-white p-4 shadow-sm">
      <h2 id="mileage-heading" className="text-base font-semibold">Mileage today</h2>
      {vehicles.map((v) => (
        <div key={v.id} className="space-y-2">
          {vehicles.length > 1 ? <p className="text-sm font-medium">{v.nickname}</p> : null}
          {mileagePrompt(stops, v.trip) === "FIRST_STOP" ? <p role="status" className="rounded-control border border-line bg-surface p-2 text-sm font-semibold">Before your first stop: enter the odometer reading below so today&apos;s miles are counted.</p> : null}
          {mileagePrompt(stops, v.trip) === "LAST_STOP" ? <p role="status" className="rounded-control border border-line bg-surface p-2 text-sm font-semibold">That was your last stop: enter the odometer reading now to finish today&apos;s miles.</p> : null}
          {!v.trip ? <OdometerForm action={startDayAction.bind(null, v.id)} label="Odometer reading when you start" submit="Start the day" defaultValue={v.lastOdometer} />
            : v.trip.endOdometer == null ? <OdometerForm action={finishDayAction.bind(null, v.trip.id)} label={`Odometer reading now (you started at ${v.trip.startOdometer.toLocaleString("en-US")})`} submit="Finish the day" defaultValue={v.trip.startOdometer} />
            : <p className="text-sm">Done: {(v.trip.miles ?? 0).toLocaleString("en-US")} miles today.</p>}
        </div>
      ))}
    </section>
  );
}
