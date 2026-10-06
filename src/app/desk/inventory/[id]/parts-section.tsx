"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPartRecordAction, deletePartRecordAction } from "../actions";

type PartRecordRow = {
  id: string;
  modelNumber: string;
  manufacturer: string | null;
  partNumber: string;
  partName: string | null;
  notes: string | null;
};

const EMPTY_FIELDS = {
  partNumber: "",
  partName: "",
  notes: "",
  compatibleModelNumbers: "",
};

/**
 * Parts logged against this unit's MODEL NUMBER — not this individual
 * appliance. See docs/BUSINESS-RULES.md and src/domains/inventory
 * (getPartRecordsForModel/createPartRecord): once Chris looks up a part
 * for this model, it's here for every future unit of the same model too.
 */
export function PartsSection({
  modelNumber,
  manufacturer,
  applianceTypeId,
  partRecords,
}: {
  modelNumber: string | null;
  manufacturer: string | null;
  applianceTypeId: string;
  partRecords: PartRecordRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [message, setMessage] = useState<
    { kind: "error" | "success"; text: string } | null
  >(null);

  if (!modelNumber) {
    return (
      <div className="rounded-lg border border-line bg-white p-5">
        <h2 className="font-medium text-ink">Parts for this model</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Add a model number above first — parts are logged by model number
          so they&apos;re there for any future unit of the same model too.
        </p>
      </div>
    );
  }

  function update<K extends keyof typeof EMPTY_FIELDS>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await createPartRecordAction({
        modelNumber,
        manufacturer,
        applianceTypeId,
        partNumber: fields.partNumber,
        partName: fields.partName,
        notes: fields.notes,
        compatibleModelNumbers: fields.compatibleModelNumbers,
      });

      if (result.status === "error") {
        setMessage({ kind: "error", text: result.message });
      } else {
        setMessage({ kind: "success", text: "Part saved." });
        setFields(EMPTY_FIELDS);
        router.refresh();
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deletePartRecordAction(id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-line bg-white p-5">
      <div>
        <h2 className="font-medium text-ink">Parts for model {modelNumber}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Saved here so you don&apos;t have to look them up again for the
          next unit of this same model.
        </p>
      </div>

      {partRecords.length === 0 ? (
        <p className="text-sm text-ink-soft">No parts logged for this model yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {partRecords.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-4 py-2">
              <div>
                <p className="text-sm font-medium text-ink">
                  {p.partNumber}
                  {p.partName ? ` — ${p.partName}` : ""}
                </p>
                {p.notes && <p className="text-sm text-ink-soft">{p.notes}</p>}
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleDelete(p.id)}
                className="shrink-0 text-sm text-red-700 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="space-y-3 border-t border-line pt-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="partNumber" className="block text-sm font-medium text-ink-soft">
              Part number
            </label>
            <input
              id="partNumber"
              type="text"
              required
              value={fields.partNumber}
              onChange={(e) => update("partNumber", e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="partName" className="block text-sm font-medium text-ink-soft">
              Part name (optional)
            </label>
            <input
              id="partName"
              type="text"
              placeholder="e.g. Door boot seal"
              value={fields.partName}
              onChange={(e) => update("partName", e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="partNotes" className="block text-sm font-medium text-ink-soft">
            Notes (optional)
          </label>
          <input
            id="partNotes"
            type="text"
            placeholder="e.g. where you ordered it from"
            value={fields.notes}
            onChange={(e) => update("notes", e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="compatibleModelNumbers"
            className="block text-sm font-medium text-ink-soft"
          >
            Also fits these model numbers (optional)
          </label>
          <input
            id="compatibleModelNumbers"
            type="text"
            placeholder="e.g. WFW5620HW1, WFW5605MW0"
            value={fields.compatibleModelNumbers}
            onChange={(e) => update("compatibleModelNumbers", e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ink-faint">
            If you know this same part works on other models too, list them
            here (comma-separated) — it&apos;ll show up when you look up
            parts for those models later, too.
          </p>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save part"}
        </button>

        {message?.kind === "error" && (
          <p role="alert" className="text-sm text-red-700">
            {message.text}
          </p>
        )}
        {message?.kind === "success" && (
          <p className="text-sm text-green-700">{message.text}</p>
        )}
      </form>
    </div>
  );
}
