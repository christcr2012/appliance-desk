"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createApplianceUnitsAction } from "./actions";

type ApplianceTypeOption = { id: string; name: string };

const EMPTY_FIELDS = {
  manufacturer: "",
  model: "",
  serialNumber: "",
  color: "",
  features: "",
  condition: "",
  purchaseDate: "",
  acquisitionCostDollars: "",
  currentLocation: "",
  notes: "",
};

export function NewApplianceForm({
  applianceTypes,
}: {
  applianceTypes: ApplianceTypeOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [applianceTypeId, setApplianceTypeId] = useState(
    applianceTypes[0]?.id ?? "",
  );
  const [quantity, setQuantity] = useState("1");
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [message, setMessage] = useState<
    { kind: "error" | "success"; text: string } | null
  >(null);

  if (applianceTypes.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        Add an appliance <em>type</em> (a category, like Washer) in Settings
        first, then come back here to add individual units of it.
      </p>
    );
  }

  const quantityNum = parseInt(quantity, 10) || 1;

  function update<K extends keyof typeof EMPTY_FIELDS>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await createApplianceUnitsAction({
        applianceTypeId,
        quantity: quantityNum,
        manufacturer: fields.manufacturer,
        model: fields.model,
        serialNumber: fields.serialNumber,
        color: fields.color,
        features: fields.features,
        condition: fields.condition,
        purchaseDate: fields.purchaseDate,
        acquisitionCostDollars: fields.acquisitionCostDollars
          ? parseFloat(fields.acquisitionCostDollars)
          : undefined,
        currentLocation: fields.currentLocation,
        notes: fields.notes,
      });

      if (result.status === "error") {
        setMessage({ kind: "error", text: result.message });
      } else {
        setMessage({
          kind: "success",
          text:
            quantityNum === 1 ? "Appliance added." : `${quantityNum} appliances added.`,
        });
        setFields(EMPTY_FIELDS);
        setQuantity("1");
        router.refresh();
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-2xl space-y-4 rounded-lg border border-line bg-white p-5"
    >
      <h2 className="font-medium text-ink">Add appliances you&apos;ve obtained</h2>

      <div>
        <label htmlFor="applianceTypeId" className="block text-sm font-medium text-ink-soft">
          Appliance type
        </label>
        <select
          id="applianceTypeId"
          value={applianceTypeId}
          onChange={(e) => setApplianceTypeId(e.target.value)}
          className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
        >
          {applianceTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="quantity" className="block text-sm font-medium text-ink-soft">
            How many
          </label>
          <input
            id="quantity"
            type="number"
            min={1}
            max={50}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="acquisitionCostDollars" className="block text-sm font-medium text-ink-soft">
            Cost each ($, optional)
          </label>
          <input
            id="acquisitionCostDollars"
            type="number"
            min={0}
            step="0.01"
            value={fields.acquisitionCostDollars}
            onChange={(e) => update("acquisitionCostDollars", e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="manufacturer" className="block text-sm font-medium text-ink-soft">
            Manufacturer (optional)
          </label>
          <input
            id="manufacturer"
            type="text"
            value={fields.manufacturer}
            onChange={(e) => update("manufacturer", e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="model" className="block text-sm font-medium text-ink-soft">
            Model (optional)
          </label>
          <input
            id="model"
            type="text"
            value={fields.model}
            onChange={(e) => update("model", e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
      </div>

      {quantityNum === 1 ? (
        <div>
          <label htmlFor="serialNumber" className="block text-sm font-medium text-ink-soft">
            Serial number (optional)
          </label>
          <input
            id="serialNumber"
            type="text"
            value={fields.serialNumber}
            onChange={(e) => update("serialNumber", e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
      ) : (
        <p className="text-sm text-ink-faint">
          Adding {quantityNum} at once — serial numbers usually differ per
          unit, so add each one&apos;s serial number individually afterward
          from its own page.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="color" className="block text-sm font-medium text-ink-soft">
            Color (optional)
          </label>
          <input
            id="color"
            type="text"
            placeholder="e.g. White, Stainless"
            value={fields.color}
            onChange={(e) => update("color", e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="features" className="block text-sm font-medium text-ink-soft">
            Features (optional)
          </label>
          <input
            id="features"
            type="text"
            placeholder="e.g. front-load, agitator"
            value={fields.features}
            onChange={(e) => update("features", e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ink-faint">Separate multiple with commas.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="condition" className="block text-sm font-medium text-ink-soft">
            Condition (optional)
          </label>
          <input
            id="condition"
            type="text"
            placeholder="e.g. New, Good, Fair"
            value={fields.condition}
            onChange={(e) => update("condition", e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="purchaseDate" className="block text-sm font-medium text-ink-soft">
            Purchase date (optional)
          </label>
          <input
            id="purchaseDate"
            type="date"
            value={fields.purchaseDate}
            onChange={(e) => update("purchaseDate", e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label htmlFor="currentLocation" className="block text-sm font-medium text-ink-soft">
          Current location (optional)
        </label>
        <input
          id="currentLocation"
          type="text"
          placeholder="e.g. Warehouse, or a customer's address"
          value={fields.currentLocation}
          onChange={(e) => update("currentLocation", e.target.value)}
          className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-ink-soft">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          rows={2}
          value={fields.notes}
          onChange={(e) => update("notes", e.target.value)}
          className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
      >
        {isPending
          ? "Adding…"
          : quantityNum === 1
            ? "Add appliance"
            : `Add ${quantityNum} appliances`}
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
  );
}
