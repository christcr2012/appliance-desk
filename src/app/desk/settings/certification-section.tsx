"use client";
import { useActionState } from "react";
import { removeCertificationAction, saveCertificationAction, type CertificationState } from "./certification-actions";

export type CertificationPerson = { id: string; name: string; role: string; certification: { certificationNumber: string; issuedOn: string | null } | null };

function Row({ person }: { person: CertificationPerson }) {
  const [saveState, save, saving] = useActionState(saveCertificationAction.bind(null, person.id), { status: "idle" } as CertificationState);
  const [removeState, remove, removing] = useActionState(removeCertificationAction.bind(null, person.id), { status: "idle" } as CertificationState);
  return (
    <li className="space-y-2 rounded-control border border-line p-3">
      <p className="font-semibold">{person.name} <span className="font-normal text-ink-soft">({person.role.toLowerCase()})</span> — {person.certification ? "certified" : "no certification on file"}</p>
      <form action={save} className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm font-medium">Certification number
          <input name="number" required maxLength={60} defaultValue={person.certification?.certificationNumber ?? ""} className="min-h-11 rounded-control border border-line p-2" />
        </label>
        <label className="grid gap-1 text-sm font-medium">Date issued (optional)
          <input name="issuedOn" type="date" defaultValue={person.certification?.issuedOn ?? ""} className="min-h-11 rounded-control border border-line p-2" />
        </label>
        <button type="submit" disabled={saving} className="min-h-11 rounded-control bg-brand px-4 font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : person.certification ? "Save changes" : "Record certification"}</button>
      </form>
      {person.certification ? (
        <form action={remove}><button type="submit" disabled={removing} className="min-h-11 rounded-control border border-line px-4 font-medium disabled:opacity-60">{removing ? "Working…" : "Remove certification"}</button></form>
      ) : null}
      {saveState.status === "error" ? <p role="alert" className="text-sm text-danger">{saveState.message}</p> : null}
      {removeState.status === "error" ? <p role="alert" className="text-sm text-danger">{removeState.message}</p> : null}
      {saveState.status === "success" ? <p role="status" className="text-sm">{saveState.message}</p> : null}
      {removeState.status === "success" ? <p role="status" className="text-sm">{removeState.message}</p> : null}
    </li>
  );
}

/** Owner only: who holds a refrigerant (EPA Section 608 Type I) certification. */
export function CertificationSection({ people }: { people: CertificationPerson[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Repairing a sealed refrigerant system (compressor, coils, refrigerant lines) legally needs a refrigerant certification (EPA Section 608, Type I covers small appliances).
        A repair visit marked &quot;sealed system&quot; can only be given to someone listed here. Starting value: nobody listed, so such repairs can&apos;t be assigned until you record a certificate. Not confirmed — ask your attorney or the EPA if you&apos;re unsure who needs one.
      </p>
      <ul className="space-y-3">{people.map((p) => <Row key={p.id} person={p} />)}</ul>
    </div>
  );
}
