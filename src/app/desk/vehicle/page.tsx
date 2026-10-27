import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { loadVehicleOverview } from "@/domains/vehicle/reads";
import { maskVin } from "@/domains/vehicle/rules";
import { archiveVehicleAction, maintenanceAction, manualTripAction, saveVehicleAction, settingsAction } from "./actions";
import { Field, Select, VehicleForm } from "./forms";

export const metadata = { title: "Vehicle and mileage" };

const dateText = (d: Date | null) => d ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" }).format(d) : "—";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthOptions: Array<[string, string]> = [["", "Not set"], ...MONTHS.map((m, i) => [String(i + 1), m] as [string, string])];
const num = (n: number) => n.toLocaleString("en-US");

type VehicleDefaults = { nickname: string; year: number; make: string; model: string; vin: string | null; plate: string | null; gvwrLbs: number; registrationMonth: number | null; odometerAtPurchase: number; maintenanceEveryMiles: number | null; maintenanceEveryMonths: number | null; lastMaintenanceOn: Date | null; lastMaintenanceMiles: number | null; medicalCardExpiresOn: Date | null; notes: string | null };

function VehicleFields({ v }: { v?: VehicleDefaults }) {
  const key = (d: Date | null | undefined) => d ? businessDateKey(d) : "";
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Name for this vehicle" name="nickname" required defaultValue={v?.nickname} hint='For example: "White van".' />
      <Field label="Year" name="year" type="number" required min={1980} defaultValue={v?.year} />
      <Field label="Make" name="make" required defaultValue={v?.make} />
      <Field label="Model" name="model" required defaultValue={v?.model} />
      <Field label="Weight rating, GVWR (pounds)" name="gvwr" type="number" required min={1000} defaultValue={v?.gvwrLbs} hint="Required. It's on the sticker inside the driver's door. It decides which license and commercial-vehicle rules apply." />
      <Field label="VIN" name="vin" defaultValue={v?.vin ?? ""} hint="Shown with all but the last 4 characters hidden." />
      <Field label="License plate" name="plate" defaultValue={v?.plate ?? ""} />
      <Select label="Registration is due in" name="registrationMonth" defaultValue={v?.registrationMonth ? String(v.registrationMonth) : ""} options={monthOptions} />
      <Field label="Odometer when you bought it" name="odometerAtPurchase" type="number" min={0} defaultValue={v?.odometerAtPurchase ?? 0} />
      <Field label="Remind me about maintenance every (miles)" name="maintenanceEveryMiles" type="number" min={0} defaultValue={v?.maintenanceEveryMiles ?? ""} hint="Optional. Ask your mechanic what fits." />
      <Field label="…or every (months)" name="maintenanceEveryMonths" type="number" min={0} defaultValue={v?.maintenanceEveryMonths ?? ""} />
      <Field label="Last service on" name="lastMaintenanceOn" type="date" defaultValue={key(v?.lastMaintenanceOn)} />
      <Field label="Odometer at the last service" name="lastMaintenanceMiles" type="number" min={0} defaultValue={v?.lastMaintenanceMiles ?? ""} />
      <Field label="Driver's medical card expires" name="medicalCardExpiresOn" type="date" defaultValue={key(v?.medicalCardExpiresOn)} />
      <Field label="Notes" name="notes" defaultValue={v?.notes ?? ""} />
    </div>
  );
}

export default async function VehiclePage() {
  const session = await requireRole("OWNER", "ADMIN");
  const isOwner = session.user.role === "OWNER";
  const now = new Date();
  const o = await loadVehicleOverview(now);
  const active = o.vehicles.filter((v) => !v.archivedAt);
  const old = o.vehicles.filter((v) => v.archivedAt);
  return (
    <div className="space-y-6">
      <PageHeader title="Vehicle and mileage" />
      <p className="text-sm text-ink-soft">
        Your delivery vehicle, the license rules that follow from its weight, and a mileage log for your taxes. Drivers enter the starting and ending odometer on the <Link className="underline" href="/desk/driver">Driver view</Link>. Vehicle insurance is kept on the Insurance screen under More.
      </p>

      {active.length === 0 ? <Card title="Your vehicle"><p className="text-sm">No vehicle yet. Add the one you deliver with below.</p></Card> : active.map((v) => (
        <Card key={v.id} title={`${v.nickname} — ${v.year} ${v.make} ${v.model}`}>
          <div className="space-y-3">
            <p className="text-sm">{v.gvwrLbs.toLocaleString("en-US")} lb GVWR · odometer about {num(v.odometer)} · {v.plate ? `plate ${v.plate} · ` : ""}{v.vin ? `VIN ${maskVin(v.vin)} · ` : ""}{v.registrationMonth ? `registration due in ${MONTHS[v.registrationMonth - 1]}` : "registration month not set"}</p>
            <div className="rounded-control border border-line p-3">
              <p className="font-semibold">{v.rules.headline}</p>
              <ul className="mt-1 list-disc pl-5 text-sm">{v.rules.points.map((p) => <li key={p}>{p}</li>)}</ul>
              <p className="mt-2 text-xs text-ink-soft">Weight lines: a CDL from 26,001 lb (federal); Colorado commercial-vehicle rules from 16,001 lb (C.R.S. 42-4-235). Summaries only — confirm with the Colorado State Patrol.</p>
            </div>
            {v.due.length > 0 ? <ul className="text-sm">{v.due.map((d) => <li key={d.key + d.label} className="font-semibold">{d.label}: <span className="font-normal">{d.detail}</span></li>)}</ul> : null}
            {v.todayTrip ? <p className="text-sm">Today&apos;s trip: started at {num(v.todayTrip.startOdometer)}{v.todayTrip.endOdometer != null ? `, finished at ${num(v.todayTrip.endOdometer)} (${num(v.todayTrip.miles ?? 0)} miles)` : " — not finished yet"}.</p> : null}
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Change this vehicle</summary>
              <VehicleForm action={saveVehicleAction.bind(null, v.id)} submit="Save changes"><VehicleFields v={v} /></VehicleForm>
            </details>
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Record a service</summary>
              <VehicleForm action={maintenanceAction.bind(null, v.id)} submit="Record service" secondary>
                <div className="grid gap-3 md:max-w-sm">
                  <Field label="Date of service" name="date" type="date" required defaultValue={businessDateKey(now)} />
                  <Field label="Odometer at the service" name="miles" type="number" required min={0} defaultValue={v.odometer} />
                </div>
              </VehicleForm>
            </details>
            <form action={archiveVehicleAction.bind(null, v.id, true)}><button type="submit" className="min-h-11 text-sm underline">Retire this vehicle</button></form>
          </div>
        </Card>
      ))}

      <Card title={active.length === 0 ? "Add your vehicle" : "Add another vehicle"}>
        <VehicleForm action={saveVehicleAction.bind(null, null)} submit="Add vehicle"><VehicleFields /></VehicleForm>
      </Card>

      {active.length > 0 ? (
        <Card title="Add a trip by hand" description="A supply run, a bank trip, anything that wasn't on the route.">
          <VehicleForm action={manualTripAction} submit="Add trip" secondary>
            <div className="grid gap-3 md:grid-cols-2">
              <Select label="Vehicle" name="vehicleId" options={active.map((v) => [v.id, v.nickname] as [string, string])} />
              <Field label="Date" name="date" type="date" required defaultValue={businessDateKey(now)} />
              <Field label="Odometer at the start" name="start" type="number" required min={0} />
              <Field label="Odometer at the end" name="end" type="number" required min={0} />
              <Field label="What it was for" name="purpose" required hint="For example: buying parts." />
              <Field label="Notes" name="notes" />
            </div>
          </VehicleForm>
        </Card>
      ) : null}

      <Card title="Miles and the mileage deduction" description="Business miles by year.">
        {o.years.length === 0 ? <p className="text-sm">No finished trips yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="py-1">Year</th><th>Business miles</th><th>Rate</th><th>{o.settings.mileageMethod === "STANDARD_RATE" ? "Deduction at the standard rate" : "Standard-rate figure (for comparison)"}</th></tr></thead>
            <tbody>
              {o.years.map((y) => (
                <tr key={y.year} className="border-t border-line">
                  <td className="py-1">{y.year}</td><td>{num(y.miles)}</td>
                  <td>{y.rateTenths != null ? `${y.rateTenths / 10}¢ a mile` : "No rate recorded"}</td>
                  <td>{y.deductionCents != null ? formatMoney(y.deductionCents) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-ink-soft">The rate comes from the dated rule book (2026: 72.5¢ a mile, IRS Notice 2026-10). Comparing with your actual vehicle costs isn&apos;t connected to your books yet; ask your accountant. Your accountant uses these miles for the vehicle line on your tax return.</p>
      </Card>

      <Card title="How you claim vehicle costs" description="Ask your accountant; it matters most in the first year.">
        <p className="mb-2 text-sm text-ink-soft">Starting value — not confirmed: the standard mileage rate in the first year, which keeps both options open for later years. A medical card is asked for from 16,001 lb up (starting value, not confirmed).</p>
        <VehicleForm action={settingsAction} submit="Save" secondary>
          <div className="grid gap-3 md:max-w-sm">
            <Select label="Method" name="method" defaultValue={o.settings.mileageMethod} options={[["STANDARD_RATE", "Standard mileage rate"], ["ACTUAL_COSTS", "Actual vehicle costs"]]} />
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="medicalCard" defaultChecked={o.settings.vehicleMedicalCardRequired} className="h-5 w-5" disabled={!isOwner} /> Ask for the driver&apos;s medical card on heavier vehicles</label>
          </div>
        </VehicleForm>
        {!isOwner ? <p className="text-sm text-ink-soft">Only the owner can change this.</p> : null}
      </Card>

      <Card title="Recent trips">
        {o.trips.length === 0 ? <p className="text-sm">No trips yet.</p> : (
          <ul className="space-y-1 text-sm">
            {o.trips.map((t) => <li key={t.id}>{dateText(t.tripDate)} — {t.vehicle.nickname}: {t.miles != null ? `${num(t.miles)} miles` : "in progress"} · {t.purpose}{t.source === "ROUTE" ? ` (${t.stops} stop${t.stops === 1 ? "" : "s"})` : " (by hand)"}</li>)}
          </ul>
        )}
      </Card>

      {old.length > 0 ? (
        <Card title="Retired vehicles">
          <ul className="space-y-2 text-sm">
            {old.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2"><span>{v.nickname} — {v.year} {v.make} {v.model}</span>
                <form action={archiveVehicleAction.bind(null, v.id, false)}><button type="submit" className="min-h-11 text-sm underline">Bring back</button></form></li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
