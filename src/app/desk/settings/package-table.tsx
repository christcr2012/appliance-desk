"use client";

import { useState, useTransition } from "react";
import { Button, Checkbox, Field, Select, StatusPill } from "@/components/ui";
import { formatCents, formatCentsAsPlainDecimal } from "@/domains/pricing/money";
import { packageContents, packageSavingSentence } from "@/domains/packages/pricing";
import {
  createPackageAction,
  updatePackageAction,
  setPackageVisibilityAction,
  setPackageActiveAction,
  type SettingsActionState,
} from "./actions";

export type PackageTypeOption = { id: string; name: string; monthlyPriceCents: number };
export type PackageRow = {
  id: string;
  name: string;
  monthlyPriceCents: number;
  showOnWebsite: boolean;
  isActive: boolean;
  components: { applianceTypeId: string; name: string; quantity: number; monthlyPriceCents: number; isActive: boolean }[];
};

type Message = { kind: "success" | "error"; text: string } | null;

function Feedback({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p
      role={message.kind === "error" ? "alert" : "status"}
      className={`text-sm font-medium ${message.kind === "error" ? "text-danger" : "text-success"}`}
    >
      {message.text}
    </p>
  );
}

const resultMessage = (result: SettingsActionState, success: string): Message =>
  result.status === "error" ? { kind: "error", text: result.message } : { kind: "success", text: success };

/** Sets and packages — Settings → Products and pricing (Batch W Amendment B, D-WB3). */
export function PackageTable({ packages, types }: { packages: PackageRow[]; types: PackageTypeOption[] }) {
  const active = packages.filter((p) => p.isActive);
  const retired = packages.filter((p) => !p.isActive);
  return (
    <div className="min-w-0 max-w-full space-y-6">
      <p className="text-sm text-ink-soft">
        A set is two or more machines rented together for one lower monthly price — for example a washer and a dryer.
        Each machine is still its own appliance in your inventory, so a washer and a dryer can also be rented on their
        own to different customers. You choose which machines a set contains and its price; the saving is worked out from
        the single prices below. Agreements already signed keep their prices.
      </p>
      {active.length === 0 && <p className="text-sm text-ink-soft">No sets yet. Add the first one below.</p>}
      <ul className="space-y-4">
        {active.map((row) => (
          <li key={row.id}>
            <PackageCard row={row} types={types} />
          </li>
        ))}
      </ul>
      <NewPackageForm types={types} />
      {retired.length > 0 && (
        <details className="max-w-4xl rounded-card border border-line bg-surface p-4">
          <summary className="cursor-pointer font-semibold text-ink">Retired sets ({retired.length})</summary>
          <ul className="mt-4 space-y-4">
            {retired.map((row) => (
              <li key={row.id}>
                <PackageCard row={row} types={types} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PackageCard({ row, types }: { row: PackageRow; types: PackageTypeOption[] }) {
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState(row.showOnWebsite);
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();
  const retiredMachines = row.components.filter((c) => !c.isActive).map((c) => c.name);

  return (
    <div className="space-y-3 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold text-ink">{row.name}</h3>
        <StatusPill tone={row.isActive ? "success" : "stopped"} label={row.isActive ? "Active" : "Retired"} />
      </div>
      <p className="text-sm text-ink">
        Contains: {packageContents(row.components)} · Set price {formatCents(row.monthlyPriceCents)} a month
      </p>
      <p className="text-sm text-ink-soft">{packageSavingSentence(row.monthlyPriceCents, row.components)}</p>
      {retiredMachines.length > 0 && (
        <p className="text-sm font-medium text-danger">
          {retiredMachines.join(" and ")} {retiredMachines.length > 1 ? "are" : "is"} retired, so this set is hidden from
          the website until you restore {retiredMachines.length > 1 ? "them" : "it"} or change the set.
        </p>
      )}
      <Checkbox
        label={`Show ${row.name} on website`}
        checked={visible}
        disabled={!row.isActive || isPending}
        onChange={(event) => {
          const next = event.target.checked;
          setVisible(next);
          setMessage(null);
          startTransition(async () => {
            const result = await setPackageVisibilityAction(row.id, next);
            if (result.status === "error") setVisible(!next);
            setMessage(resultMessage(result, next ? "Now shown on the website." : "Hidden from the website."));
          });
        }}
      />
      <Feedback message={message} />
      <div className="flex flex-wrap gap-3">
        {row.isActive && (
          <Button type="button" variant="secondary" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close editor" : "Change set"}
          </Button>
        )}
        <Button
          type="button"
          variant={row.isActive ? "danger" : "secondary"}
          disabled={isPending}
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const result = await setPackageActiveAction(row.id, !row.isActive);
              if (result.status === "error") setMessage(resultMessage(result, ""));
            });
          }}
        >
          {row.isActive ? "Retire" : "Restore"}
        </Button>
      </div>
      {editing && (
        <PackageEditor
          types={types}
          initial={{
            name: row.name,
            price: formatCentsAsPlainDecimal(row.monthlyPriceCents),
            components: row.components.map((c) => ({ applianceTypeId: c.applianceTypeId, quantity: String(c.quantity) })),
          }}
          submitLabel="Save set"
          onSubmit={(values) => updatePackageAction(row.id, values)}
          onSaved={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function NewPackageForm({ types }: { types: PackageTypeOption[] }) {
  return (
    <div className="max-w-2xl rounded-card border border-line bg-subtle p-4">
      <h3 className="mb-3 font-semibold text-ink">Add a set</h3>
      <PackageEditor
        types={types}
        initial={{ name: "", price: "", components: [{ applianceTypeId: "", quantity: "1" }, { applianceTypeId: "", quantity: "1" }] }}
        submitLabel="Add set"
        onSubmit={(values) => createPackageAction(values)}
        resetOnSave
      />
    </div>
  );
}

type EditorValues = { name: string; price: string; components: { applianceTypeId: string; quantity: string }[] };

function PackageEditor({
  types,
  initial,
  submitLabel,
  onSubmit,
  onSaved,
  resetOnSave = false,
}: {
  types: PackageTypeOption[];
  initial: EditorValues;
  submitLabel: string;
  onSubmit: (values: unknown) => Promise<SettingsActionState>;
  onSaved?: () => void;
  resetOnSave?: boolean;
}) {
  const [values, setValues] = useState<EditorValues>(initial);
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();
  const priceById = new Map(types.map((t) => [t.id, t.monthlyPriceCents]));
  const chosen = values.components
    .filter((c) => c.applianceTypeId)
    .map((c) => ({ quantity: Number(c.quantity) || 0, monthlyPriceCents: priceById.get(c.applianceTypeId) ?? 0 }));
  const priceCents = Math.round((Number(values.price) || 0) * 100);
  const setComponent = (index: number, patch: Partial<EditorValues["components"][number]>) =>
    setValues((v) => ({ ...v, components: v.components.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        startTransition(async () => {
          try {
            const result = await onSubmit({
              name: values.name,
              monthlyPriceDollars: values.price === "" ? Number.NaN : Number(values.price),
              components: values.components
                .filter((c) => c.applianceTypeId)
                .map((c) => ({ applianceTypeId: c.applianceTypeId, quantity: Number(c.quantity) })),
            });
            setMessage(resultMessage(result, "Saved. New quotes and the website use it; signed agreements keep their prices."));
            if (result.status === "success") {
              if (resetOnSave) setValues(initial);
              onSaved?.();
            }
          } catch {
            setMessage({ kind: "error", text: "The save was not confirmed. Reload to check before trying again." });
          }
        });
      }}
    >
      <Field
        label="Name of the set"
        value={values.name}
        onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
        placeholder="Washer + Dryer Set"
        help="What customers see on the website and on quotes."
        required
      />
      <div className="max-w-xs">
        <Field
          label="Set price per month (dollars)"
          type="number"
          min={0}
          step="0.01"
          value={values.price}
          onChange={(e) => setValues((v) => ({ ...v, price: e.target.value }))}
          help="What the customer pays a month for the whole set."
          required
        />
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">Machines in this set</legend>
        {values.components.map((component, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-[minmax(10rem,16rem)_6rem_auto] sm:items-end">
            <Select
              label={`Machine ${index + 1}`}
              value={component.applianceTypeId}
              onChange={(e) => setComponent(index, { applianceTypeId: e.target.value })}
            >
              <option value="">Choose a machine type</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({formatCents(t.monthlyPriceCents)} a month on its own)
                </option>
              ))}
            </Select>
            <Field
              label="How many"
              type="number"
              min={1}
              max={10}
              step={1}
              value={component.quantity}
              onChange={(e) => setComponent(index, { quantity: e.target.value })}
            />
            <Button
              type="button"
              variant="quiet"
              disabled={values.components.length <= 1}
              onClick={() => setValues((v) => ({ ...v, components: v.components.filter((_, i) => i !== index) }))}
            >
              Remove machine {index + 1}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() => setValues((v) => ({ ...v, components: [...v.components, { applianceTypeId: "", quantity: "1" }] }))}
        >
          Add another machine
        </Button>
        <p className="text-xs text-ink-faint">
          Any appliance type you have added can be part of a set, including ones you add later.
        </p>
      </fieldset>
      {chosen.length > 0 && values.price !== "" && (
        <p className="text-sm text-ink" aria-live="polite">
          {packageSavingSentence(priceCents, chosen)}
        </p>
      )}
      <Feedback message={message} />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
