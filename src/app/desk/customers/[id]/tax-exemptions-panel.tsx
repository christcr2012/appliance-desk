"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { PhotoUploadField } from "@/components/photo-upload-field";
import {
  revokeCustomerTaxExemptionAction,
  saveCustomerTaxExemptionAction,
  type TaxExemptionActionInput,
} from "../actions";

type Exemption = {
  id: string;
  reason: "RESALE" | "GOVERNMENT" | "CHARITABLE" | "OTHER";
  certificateNumber: string | null;
  certificatePhotoId: string | null;
  jurisdictionIds: string[];
  validFrom: string;
  expiresOn: string | null;
  revokedAt: string | null;
  notes: string | null;
};

type Jurisdiction = {
  id: string;
  name: string;
  level: string;
};

const REASON_LABELS: Record<Exemption["reason"], string> = {
  RESALE: "Resale",
  GOVERNMENT: "Government",
  CHARITABLE: "Charitable",
  OTHER: "Other",
};

function emptyInput(): TaxExemptionActionInput {
  return {
    reason: "RESALE",
    certificateNumber: "",
    certificatePhotoId: "",
    validFrom: "",
    expiresOn: "",
    allJurisdictions: true,
    jurisdictionIds: [],
    notes: "",
  };
}

function inputFromExemption(exemption: Exemption): TaxExemptionActionInput {
  return {
    exemptionId: exemption.id,
    reason: exemption.reason,
    certificateNumber: exemption.certificateNumber ?? "",
    certificatePhotoId: exemption.certificatePhotoId ?? "",
    validFrom: exemption.validFrom,
    expiresOn: exemption.expiresOn ?? "",
    allJurisdictions: exemption.jurisdictionIds.length === 0,
    jurisdictionIds: exemption.jurisdictionIds,
    notes: exemption.notes ?? "",
  };
}

function TaxExemptionForm({
  customerId,
  jurisdictions,
  initial,
  submitLabel,
}: {
  customerId: string;
  jurisdictions: Jurisdiction[];
  initial: TaxExemptionActionInput;
  submitLabel: string;
}) {
  const router = useRouter();
  const [input, setInput] = useState<TaxExemptionActionInput>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof TaxExemptionActionInput>(
    key: K,
    value: TaxExemptionActionInput[K],
  ) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  function toggleJurisdiction(id: string, checked: boolean) {
    setInput((current) => ({
      ...current,
      jurisdictionIds: checked
        ? [...new Set([...current.jurisdictionIds, id])]
        : current.jurisdictionIds.filter((value) => value !== id),
    }));
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveCustomerTaxExemptionAction(customerId, input);
      if (result.status === "error") {
        setMessage(result.message);
        return;
      }
      setMessage("Saved.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-ink">
          Reason
          <select
            value={input.reason}
            onChange={(event) =>
              set("reason", event.target.value as Exemption["reason"])
            }
            className="mt-1 min-h-11 w-full rounded-md border border-line-strong bg-white px-3 text-ink"
          >
            {Object.entries(REASON_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-ink">
          Certificate number
          <input
            value={input.certificateNumber ?? ""}
            onChange={(event) => set("certificateNumber", event.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-line-strong bg-white px-3 text-ink"
            maxLength={200}
          />
        </label>
        <label className="text-sm font-medium text-ink">
          Valid from
          <input
            type="date"
            required
            value={input.validFrom}
            onChange={(event) => set("validFrom", event.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-line-strong bg-white px-3 text-ink"
          />
        </label>
        <label className="text-sm font-medium text-ink">
          Expires on
          <input
            type="date"
            value={input.expiresOn ?? ""}
            onChange={(event) => set("expiresOn", event.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-line-strong bg-white px-3 text-ink"
          />
        </label>
      </div>

      <div>
        <p className="text-sm font-medium text-ink">Certificate photo</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <PhotoUploadField
            pathPrefix={`tax-exemptions/${customerId}`}
            access="private"
            label={input.certificatePhotoId ? "Replace certificate photo" : "Add certificate photo"}
            disabled={pending}
            onUploaded={(storageUrl, previewUrl) => {
              URL.revokeObjectURL(previewUrl);
              set("certificatePhotoId", storageUrl);
              setMessage("Certificate photo uploaded. Save the exemption to attach it.");
            }}
            onError={setMessage}
          />
          <span className="text-sm text-ink-soft">
            {input.certificatePhotoId ? "Private certificate photo on file." : "No certificate photo on file."}
          </span>
          {input.certificatePhotoId && (
            <button
              type="button"
              className="text-sm text-primary underline"
              onClick={() => set("certificatePhotoId", "")}
              disabled={pending}
            >
              Remove photo
            </button>
          )}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Jurisdiction scope</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={input.allJurisdictions}
            onChange={(event) => set("allJurisdictions", event.target.checked)}
          />
          All tax jurisdictions for this customer
        </label>
        {!input.allJurisdictions && (
          <div className="rounded-md border border-line p-3">
            {jurisdictions.length === 0 ? (
              <p className="text-sm text-ink-soft">
                No current or historical tax jurisdictions are available for this customer yet.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {jurisdictions.map((jurisdiction) => (
                  <label
                    key={jurisdiction.id}
                    className="flex min-h-11 items-center gap-2 text-sm text-ink"
                  >
                    <input
                      type="checkbox"
                      checked={input.jurisdictionIds.includes(jurisdiction.id)}
                      onChange={(event) =>
                        toggleJurisdiction(jurisdiction.id, event.target.checked)
                      }
                    />
                    <span>
                      {jurisdiction.name}{" "}
                      <span className="text-ink-soft">
                        ({jurisdiction.level.replaceAll("_", " ").toLowerCase()})
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </fieldset>

      <label className="block text-sm font-medium text-ink">
        Notes
        <textarea
          value={input.notes ?? ""}
          onChange={(event) => set("notes", event.target.value)}
          rows={3}
          maxLength={2000}
          className="mt-1 w-full rounded-md border border-line-strong bg-white px-3 py-2 text-ink"
        />
      </label>

      {message && (
        <p className="text-sm text-ink-soft" role="status">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

export function TaxExemptionsPanel({
  customerId,
  canEdit,
  exemptions,
  jurisdictions,
}: {
  customerId: string;
  canEdit: boolean;
  exemptions: Exemption[];
  jurisdictions: Jurisdiction[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function revoke(exemptionId: string) {
    if (!window.confirm("Revoke this tax exemption now? Historical records will remain on file.")) return;
    setMessage(null);
    startTransition(async () => {
      const result = await revokeCustomerTaxExemptionAction(customerId, exemptionId);
      if (result.status === "error") {
        setMessage(result.message);
        return;
      }
      setMessage("Tax exemption revoked.");
      router.refresh();
    });
  }

  return (
    <div className="mt-6 rounded-lg border border-line bg-white p-5">
      <h2 className="font-medium text-ink">Tax exemptions</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Exemptions apply only while valid and only to the jurisdictions covered by the certificate.
        Revoking one keeps its history and stops it from applying from that time forward.
      </p>

      {message && (
        <p className="mt-3 text-sm text-ink-soft" role="status">
          {message}
        </p>
      )}

      {exemptions.length > 0 ? (
        <div className="mt-4 space-y-3">
          {exemptions.map((exemption) => (
            <details key={exemption.id} className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer font-medium text-ink">
                {REASON_LABELS[exemption.reason]} · valid from {exemption.validFrom}
                {exemption.expiresOn ? ` · expires ${exemption.expiresOn}` : ""}
                {exemption.revokedAt ? " · revoked" : ""}
              </summary>
              <div className="mt-3 space-y-2 text-sm text-ink-soft">
                <p>
                  Certificate: {exemption.certificateNumber || "No number recorded"} ·{" "}
                  {exemption.certificatePhotoId ? "private photo on file" : "no photo"}
                </p>
                <p>
                  Scope:{" "}
                  {exemption.jurisdictionIds.length === 0
                    ? "all jurisdictions"
                    : exemption.jurisdictionIds
                        .map(
                          (id) =>
                            jurisdictions.find((jurisdiction) => jurisdiction.id === id)?.name ?? id,
                        )
                        .join(", ")}
                </p>
                {exemption.notes && <p>{exemption.notes}</p>}
              </div>

              {canEdit && !exemption.revokedAt && (
                <div className="mt-4 space-y-3">
                  <TaxExemptionForm
                    customerId={customerId}
                    jurisdictions={jurisdictions}
                    initial={inputFromExemption(exemption)}
                    submitLabel="Save exemption"
                  />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => revoke(exemption.id)}
                    className="inline-flex min-h-11 items-center text-sm font-medium text-danger underline disabled:opacity-60"
                  >
                    Revoke exemption
                  </button>
                </div>
              )}
            </details>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-soft">No tax exemptions on file.</p>
      )}

      {canEdit && (
        <details className="mt-4 rounded-lg border border-line p-3">
          <summary className="cursor-pointer font-medium text-ink">
            Add tax exemption
          </summary>
          <div className="mt-3">
            <TaxExemptionForm
              customerId={customerId}
              jurisdictions={jurisdictions}
              initial={emptyInput()}
              submitLabel="Add exemption"
            />
          </div>
        </details>
      )}
    </div>
  );
}
