"use client";

import { useState, useTransition } from "react";
import { formatCents } from "@/domains/pricing/money";
import { addEstimateLineItemAction, removeEstimateLineItemAction } from "../actions";
import { PackageLineChooser, type PackageLineOption } from "@/components/desk/package-line-chooser";

type LineItem = {
  id: string;
  description: string;
  quantity: number;
  monthlyPriceCents: number;
  oneTimeFeeCents: number;
  propertyLabel: string | null;
};

export function EstimateLineItemsPanel({
  estimateId,
  lineItems,
  serviceAddresses,
  editable,
  packages = [],
}: {
  estimateId: string;
  lineItems: LineItem[];
  serviceAddresses: { id: string; label: string }[];
  editable: boolean;
  packages?: PackageLineOption[];
}) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-ink-soft">Line items</h2>

      {lineItems.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">No line items yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-white">
          {lineItems.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="text-ink">
                  {line.quantity > 1 ? `${line.quantity}× ` : ""}
                  {line.description}
                </p>
                {line.propertyLabel && (
                  <p className="text-xs text-ink-faint">{line.propertyLabel}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right text-ink-soft">
                  {line.monthlyPriceCents > 0 && <p>{formatCents(line.monthlyPriceCents)}/mo</p>}
                  {line.oneTimeFeeCents > 0 && <p>{formatCents(line.oneTimeFeeCents)} one-time</p>}
                </div>
                {editable && <RemoveLineButton estimateId={estimateId} lineItemId={line.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="mt-4">
          <AddLineItemForm estimateId={estimateId} serviceAddresses={serviceAddresses} packages={packages} />
        </div>
      )}
    </div>
  );
}

function RemoveLineButton({ estimateId, lineItemId }: { estimateId: string; lineItemId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await removeEstimateLineItemAction(estimateId, lineItemId);
        })
      }
      className="text-xs text-red-700 hover:underline disabled:opacity-50"
    >
      Remove
    </button>
  );
}

function AddLineItemForm({
  estimateId,
  serviceAddresses,
  packages,
}: {
  estimateId: string;
  serviceAddresses: { id: string; label: string }[];
  packages: PackageLineOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [serviceAddressId, setServiceAddressId] = useState("");
  const [monthlyPriceDollars, setMonthlyPriceDollars] = useState("");
  const [oneTimeFeeDollars, setOneTimeFeeDollars] = useState("");
  const [packageId, setPackageId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addEstimateLineItemAction(estimateId, {
        description,
        quantity,
        serviceAddressId,
        monthlyPriceDollars,
        oneTimeFeeDollars,
        packageId,
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setDescription("");
      setQuantity("1");
      setMonthlyPriceDollars("");
      setOneTimeFeeDollars("");
      setPackageId("");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-dashed border-line-strong p-4"
    >
      <PackageLineChooser
        id="li-package"
        forQuote
        packages={packages}
        value={packageId}
        disabled={isPending}
        onChoose={(choice) => {
          setPackageId(choice?.packageId ?? "");
          if (choice) {
            setDescription(choice.label);
            setMonthlyPriceDollars(choice.priceDollars);
          }
        }}
      />
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label htmlFor="li-description" className="block text-xs font-medium text-ink-soft">
            Description
          </label>
          <input
            id="li-description"
            type="text"
            required
            placeholder="e.g. Washer/dryer set — unit 1"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="li-quantity" className="block text-xs font-medium text-ink-soft">
            Qty
          </label>
          <input
            id="li-quantity"
            type="number"
            min="1"
            max="500"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 w-20 rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="li-monthly" className="block text-xs font-medium text-ink-soft">
            $/month, each
          </label>
          <input
            id="li-monthly"
            type="number"
            min="0"
            step="0.01"
            value={monthlyPriceDollars}
            onChange={(e) => setMonthlyPriceDollars(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="li-onetime" className="block text-xs font-medium text-ink-soft">
            One-time fee, each
          </label>
          <input
            id="li-onetime"
            type="number"
            min="0"
            step="0.01"
            value={oneTimeFeeDollars}
            onChange={(e) => setOneTimeFeeDollars(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        {serviceAddresses.length > 0 && (
          <div>
            <label htmlFor="li-property" className="block text-xs font-medium text-ink-soft">
              Property (optional)
            </label>
            <select
              id="li-property"
              value={serviceAddressId}
              onChange={(e) => setServiceAddressId(e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            >
              <option value="">Not property-specific</option>
              {serviceAddresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-ink-soft hover:border-line-strong disabled:opacity-50"
      >
        {isPending ? "Adding…" : "+ Add line item"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
