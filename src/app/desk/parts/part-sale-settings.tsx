"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Field } from "@/components/ui";
import { formatMoney, moneyInputValue } from "@/lib/money-ui";
import { updatePartSaleSettingsAction } from "../purchasing-actions";

/** Batch M: sell this part to customers, at what price, and whether it is usually bought to resell. */
export function PartSaleSettings({
  partRecordId, sellable, retailPriceCents, defaultForResale, averageCostCents, archived = false,
}: {
  partRecordId: string;
  sellable: boolean;
  retailPriceCents: number | null;
  defaultForResale: boolean;
  /** Average cost of the units bought for resale that are on the shelf, when there are any. */
  averageCostCents: number | null;
  archived?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [on, setOn] = useState(sellable);
  const [price, setPrice] = useState(retailPriceCents === null ? "" : moneyInputValue(retailPriceCents));
  const [resale, setResale] = useState(defaultForResale);
  const [error, setError] = useState<string | null>(null);
  const money = formatMoney;

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updatePartSaleSettingsAction(partRecordId, { sellable: on, priceDollars: price, defaultForResale: resale });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-ink-soft">
          {sellable && retailPriceCents !== null
            ? `Sold to customers at ${money(retailPriceCents)}${
                averageCostCents !== null ? ` (your cost about ${money(averageCostCents)} each)` : ""
              }`
            : "Not sold to customers"}
        </p>
        {!archived && (
          <Button type="button" variant="secondary" onClick={() => { setError(null); setEditing(true); }}>
            {sellable ? "Change selling details" : "Sell to customers"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={save} className="grid gap-2">
      <Checkbox
        id={`sell-${partRecordId}`}
        label="Sell this part to customers"
        help="Turns it into an item you can put on a sale. Nothing changes for how you use it on repairs."
        checked={on}
        onChange={(event) => setOn(event.target.checked)}
      />
      {on && (
        <>
          <Field
            id={`price-${partRecordId}`}
            label="Price you sell it for ($)"
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
          <Checkbox
            id={`resale-${partRecordId}`}
            label="Usually bought to resell"
            help="Only pre-ticks “bought to resell” on new purchase orders for this part. Each order still gets the final say."
            checked={resale}
            onChange={(event) => setResale(event.target.checked)}
          />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending}>Save</Button>
        <Button type="button" variant="quiet" disabled={isPending} onClick={() => setEditing(false)}>Cancel</Button>
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </form>
  );
}
