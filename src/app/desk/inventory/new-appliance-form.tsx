"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select, Textarea } from "@/components/ui";
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
    setFields((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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
            quantityNum === 1
              ? "Appliance added."
              : `${quantityNum} appliances added.`,
        });
        setFields(EMPTY_FIELDS);
        setQuantity("1");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select
        id="applianceTypeId"
        label="Appliance type"
        value={applianceTypeId}
        onChange={(event) => setApplianceTypeId(event.target.value)}
      >
        {applianceTypes.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name}
          </option>
        ))}
      </Select>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id="quantity"
          label="How many"
          type="number"
          min={1}
          max={50}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <Field
          id="acquisitionCostDollars"
          label="Cost each ($, optional)"
          type="number"
          min={0}
          step="0.01"
          value={fields.acquisitionCostDollars}
          onChange={(event) =>
            update("acquisitionCostDollars", event.target.value)
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id="manufacturer"
          label="Manufacturer (optional)"
          value={fields.manufacturer}
          onChange={(event) => update("manufacturer", event.target.value)}
        />
        <Field
          id="model"
          label="Model (optional)"
          value={fields.model}
          onChange={(event) => update("model", event.target.value)}
        />
      </div>

      {quantityNum === 1 ? (
        <Field
          id="serialNumber"
          label="Serial number (optional)"
          value={fields.serialNumber}
          onChange={(event) => update("serialNumber", event.target.value)}
        />
      ) : (
        <p className="text-sm text-ink-faint">
          Adding {quantityNum} at once — serial numbers usually differ per
          unit, so add each one&apos;s serial number individually afterward
          from its own page.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id="color"
          label="Color (optional)"
          placeholder="e.g. White, Stainless"
          value={fields.color}
          onChange={(event) => update("color", event.target.value)}
        />
        <Field
          id="features"
          label="Features (optional)"
          help="Separate multiple with commas."
          placeholder="e.g. front-load, agitator"
          value={fields.features}
          onChange={(event) => update("features", event.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id="condition"
          label="Condition (optional)"
          placeholder="e.g. New, Good, Fair"
          value={fields.condition}
          onChange={(event) => update("condition", event.target.value)}
        />
        <Field
          id="purchaseDate"
          label="Purchase date (optional)"
          type="date"
          value={fields.purchaseDate}
          onChange={(event) => update("purchaseDate", event.target.value)}
        />
      </div>

      <Field
        id="currentLocation"
        label="Current location (optional)"
        placeholder="e.g. Warehouse, or a customer's address"
        value={fields.currentLocation}
        onChange={(event) => update("currentLocation", event.target.value)}
      />

      <Textarea
        id="notes"
        label="Notes (optional)"
        rows={2}
        value={fields.notes}
        onChange={(event) => update("notes", event.target.value)}
      />

      <Button type="submit" disabled={isPending}>
        {isPending
          ? "Adding…"
          : quantityNum === 1
            ? "Add appliance"
            : `Add ${quantityNum} appliances`}
      </Button>

      {message?.kind === "error" && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {message.text}
        </p>
      )}
      {message?.kind === "success" && (
        <p role="status" className="text-sm font-semibold text-success">
          {message.text}
        </p>
      )}
    </form>
  );
}
