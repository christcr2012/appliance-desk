"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { locationWorkspace, LocationPermission } from "@/domains/customers/location-contacts";
import {
  addLocationPersonAction, commitLocationImportAction, endLocationPersonAction,
  previewLocationImportAction, updateLocationAccountAction,
  updateLocationSiteAction, updateTenantRetentionAction,
  type MutationState,
} from "@/app/account/properties/actions";

type Workspace = Awaited<ReturnType<typeof locationWorkspace>>;
type Site = Workspace["serviceAddresses"][number];
const fields = [
  { key: "deliveryPickup", label: "Delivery and pickup scheduling" },
  { key: "maintenance", label: "Repairs and maintenance" },
  { key: "swaps", label: "Replacement / swap scheduling" },
  { key: "copyClient", label: "Copy client on appointment changes" },
] as const;
function permissionFrom(form: FormData): LocationPermission {
  return {
    deliveryPickup: form.has("deliveryPickup"),
    maintenance: form.has("maintenance"),
    swaps: form.has("swaps"),
    copyClient: form.has("copyClient"),
    appointmentConfirmer: form.get("appointmentConfirmer") === "TENANT" ? "TENANT" : "CLIENT",
  };
}
function PermissionFields({ initial }: { initial: LocationPermission }) {
  return <div className="grid gap-2 rounded-md bg-subtle p-3">
    {fields.map(field => <label key={field.key} className="flex gap-2 text-sm">
      <input className="accent-primary" name={field.key} type="checkbox" defaultChecked={initial[field.key]} />
      <span>{field.label}</span>
    </label>)}
    <label className="text-sm">Who confirms appointments?
      <select name="appointmentConfirmer" defaultValue={initial.appointmentConfirmer}
        className="ml-2 rounded border border-line p-2">
        <option value="CLIENT">Client</option><option value="TENANT">Tenant (if permitted)</option>
      </select>
    </label>
  </div>;
}
function dateLabel(value: Date | string | null) {
  return value ? new Date(value).toLocaleDateString() : "Not recorded";
}
function SiteEditor({ customerId, site, mutate, busy }: {
  customerId: string; site: Site; mutate: (key: string, task: () => Promise<MutationState>) => void;
  busy: boolean;
}) {
  const [showContact, setShowContact] = useState(false);
  const [override, setOverride] = useState(site.locationContactPolicy !== null);
  return <section className="rounded-lg border border-line p-4 space-y-3">
    <h3 className="font-semibold text-ink">
      {site.unitLabel ? site.unitLabel + " · " : ""}{site.line1}, {site.city} {site.zip}
    </h3>
    <form className="space-y-3" onSubmit={(e: FormEvent<HTMLFormElement>) => {
      e.preventDefault(); const data = new FormData(e.currentTarget);
      mutate(site.id + ":details", () => updateLocationSiteAction(customerId, site.id, {
        unitLabel: String(data.get("unitLabel") ?? ""),
        accessNotes: String(data.get("accessNotes") ?? ""),
        override: override ? permissionFrom(data) : null,
      }));
    }}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">Unit label (optional)
          <input name="unitLabel" aria-label="Unit label" defaultValue={site.unitLabel ?? ""}
            maxLength={80} className="block w-full rounded border border-line p-2" placeholder="Unit 4B" />
        </label>
        <label className="text-sm">Private access notes (only assigned visit staff)
          <textarea name="accessNotes" aria-label="Private access notes" defaultValue={site.accessNotes ?? ""}
            maxLength={2000} rows={2} className="block w-full rounded border border-line p-2"
            placeholder="Parking, pets, gate instructions" />
        </label>
      </div>
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />
        Override the client's contact permissions for this location
      </label>
      {override && <PermissionFields initial={site.permission} />}
      <button className="rounded bg-action px-3 py-2 text-sm text-on-action disabled:opacity-50" disabled={busy}>
        Save site details and permission
      </button>
    </form>
    <div className="border-t border-line pt-3">
      <div className="flex justify-between items-center gap-2">
        <h4 className="font-medium">Tenant / on-site contacts</h4>
        <button type="button" onClick={() => setShowContact(x => !x)}
          className="text-primary underline">{showContact ? "Close" : "Add contact"}</button>
      </div>
      <p className="my-2 text-xs text-ink-soft">Tenants are never customers and cannot see account prices. Recording a phone number or client permission does not opt a tenant into SMS.</p>
      <ul className="space-y-2">
        {site.locationContacts.map(person => <li key={person.id} className="rounded border border-line p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <span><strong>{person.erasedAt ? "Former occupant (details erased)" : person.name}</strong>{" "}
              · {person.role === "TENANT" ? "Tenant" : "On-site contact"} · {person.preferredLanguage}</span>
            {!person.endedAt && !person.erasedAt && <span className="flex gap-2">
              <button type="button" disabled={busy}
                onClick={() => mutate(site.id + ":" + person.id,
                  () => endLocationPersonAction(customerId, site.id, person.id, false))}
                className="text-primary underline">Move out</button>
              <button type="button" disabled={busy}
                onClick={() => mutate(site.id + ":" + person.id,
                  () => endLocationPersonAction(customerId, site.id, person.id, true))}
                className="text-primary underline">Move out + inspection To do</button>
            </span>}
          </div>
          {!person.erasedAt && <p className="text-ink-soft">{person.phone || "No phone"} · {person.email || "No email"}
            {person.endedAt ? " · Moved out " + dateLabel(person.endedAt) : " · Current"}
          </p>}
        </li>)}
        {!site.locationContacts.length && <li className="text-ink-soft text-sm">No on-site contacts recorded.</li>}
      </ul>
      {showContact && <form className="mt-3 grid gap-2 sm:grid-cols-2"
        onSubmit={e => {
          e.preventDefault(); const form = new FormData(e.currentTarget);
          mutate(site.id + ":person", () => addLocationPersonAction(customerId, site.id, {
            name: String(form.get("name") ?? ""), role: String(form.get("role") ?? "TENANT"),
            phone: String(form.get("phone") ?? ""), email: String(form.get("email") ?? ""),
            preferredLanguage: String(form.get("preferredLanguage") ?? "en"),
            startedAt: String(form.get("startedAt") ?? ""),
          }));
        }}>
        <label className="text-sm">Name <input name="name" required maxLength={160}
          className="block w-full rounded border border-line p-2" /></label>
        <label className="text-sm">Role <select name="role" className="block w-full rounded border border-line p-2">
          <option value="TENANT">Tenant</option><option value="ONSITE_CONTACT">On-site contact</option>
        </select></label>
        <label className="text-sm">Phone <input name="phone" maxLength={35}
          className="block w-full rounded border border-line p-2" /></label>
        <label className="text-sm">Email <input name="email" type="email" maxLength={200}
          className="block w-full rounded border border-line p-2" /></label>
        <label className="text-sm">Preferred language <select name="preferredLanguage"
          className="block w-full rounded border border-line p-2">
          <option value="en">English</option><option value="es">Español</option>
        </select></label>
        <label className="text-sm">Move-in date (optional) <input name="startedAt" type="date"
          className="block w-full rounded border border-line p-2" /></label>
        <button disabled={busy} className="rounded bg-action px-3 py-2 text-on-action disabled:opacity-50">
          Add location contact</button>
      </form>}
    </div>
  </section>;
}
export function LocationsPanel({ customerId, locations, owner, retentionMonths }: {
  customerId: string; locations: Workspace; owner: boolean; retentionMonths: number | null;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{
    count: number; digest: string; addresses: { street: string; unit: string; city: string; zip: string }[];
  } | null>(null);
  function mutate(_key: string, task: () => Promise<MutationState>) {
    startTransition(async () => {
      const result = await task();
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }
  return <div className="space-y-5">
    <form onSubmit={e => {
      e.preventDefault();
      mutate("account", () => updateLocationAccountAction(customerId,
        permissionFrom(new FormData(e.currentTarget))));
    }} className="rounded-lg border border-line p-4 space-y-3">
      <h2 className="text-lg font-semibold">Account-wide tenant contact permission</h2>
      <p className="text-sm text-ink-soft">Only the client can authorize contact topics. Location overrides take precedence. Tenant consent to automated texts is a separate requirement.</p>
      <PermissionFields initial={locations.permission} />
      <button disabled={busy} className="rounded bg-action px-3 py-2 text-on-action disabled:opacity-50">
        Save account permissions</button>
    </form>
    <h2 className="text-xl font-semibold">Locations</h2>
    {locations.serviceAddresses.map(site =>
      <SiteEditor key={site.id} customerId={customerId} site={site} mutate={mutate} busy={busy} />)}
    {!locations.serviceAddresses.length && <p>No locations on this account.</p>}
    {owner && <section className="rounded-lg border border-line p-4 space-y-3">
      <h2 className="text-lg font-semibold">Bulk property and tenant import</h2>
      <p className="text-sm text-ink-soft">Paste a CSV with columns street,unit,city,state,zip,unitLabel,tenantName,tenantPhone,tenantEmail,language. Preview validates every row; commit is atomic. No tenant is invited or messaged.</p>
      <textarea aria-label="Import CSV" value={csv} onChange={e => { setCsv(e.target.value); setPreview(null); }}
        className="min-h-32 w-full rounded border border-line p-2 font-mono text-xs" maxLength={120000} />
      <div className="flex gap-3">
        <button type="button" disabled={busy} className="rounded border border-control p-2"
          onClick={() => startTransition(async () => {
            const result = await previewLocationImportAction(customerId, csv);
            if (result.ok) { setPreview(result); setMessage("Review " + result.count + " valid locations."); }
            else { setPreview(null); setMessage(result.message); }
          })}>Preview / validate</button>
        {preview && <button type="button" disabled={busy}
          className="rounded bg-action px-3 py-2 text-on-action" onClick={() =>
            mutate("import", () => commitLocationImportAction(customerId, csv, preview.digest))}>
          Confirm import {preview.count} locations</button>}
      </div>
      {preview && <ul className="list-disc pl-5 text-sm">
        {preview.addresses.map((a,i) => <li key={i}>{a.street} {a.unit}, {a.city} {a.zip}</li>)}
      </ul>}
    </section>}
    {retentionMonths !== null && <form className="rounded-lg border border-line p-4"
      onSubmit={e => {
        e.preventDefault(); const d = new FormData(e.currentTarget);
        mutate("retention", () => updateTenantRetentionAction(Number(d.get("months"))));
      }}>
      <h2 className="font-semibold">Past-tenant privacy retention</h2>
      <p className="text-sm text-ink-soft">After move-out, erase former tenant name, email and phone automatically. Retain only non-identifying records. Default 12 months.</p>
      <label className="text-sm">Months
        <input name="months" type="number" min={1} max={120} step={1} defaultValue={retentionMonths}
          className="mx-2 w-20 rounded border border-line p-2" />
      </label>
      <button disabled={busy} className="rounded bg-action px-3 py-2 text-on-action">Save retention</button>
    </form>}
    {message && <p role="status" className="rounded border border-line p-3 text-sm">{message}</p>}
  </div>;
}
