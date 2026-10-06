"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field } from "@/components/ui";
import {
  markPurchaseOrderOrderedAction,
  receivePurchaseOrderLinesAction,
  cancelPurchaseOrderAction,
} from "../../purchasing-actions";

export type ReceivableLine = {
  id: string;
  description: string;
  outstanding: number;
  unitCostKnown: boolean;
  unitCostCents: number;
  hasPart: boolean;
};

export function PurchaseOrderActionsPanel({
  purchaseOrderId,
  status,
  lines = [],
}: {
  purchaseOrderId: string;
  status: "DRAFT" | "ORDERED";
  lines?: ReceivableLine[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [operationKey, setOperationKey] = useState(
    () => `ui-${crypto.randomUUID()}`,
  );
  const open = lines.filter((line) => line.outstanding > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      open.map((line) => [line.id, String(line.outstanding)]),
    ),
  );
  const [prices, setPrices] = useState<Record<string, string>>({});

  function receive() {
    setError(null);
    const chosen = open
      .map((line) => ({
        line,
        quantity: Number(quantities[line.id] ?? "0"),
      }))
      .filter(
        (item) =>
          Number.isFinite(item.quantity) && item.quantity > 0,
      );

    if (chosen.length === 0) {
      setError("Enter how many arrived on at least one line.");
      return;
    }

    startTransition(async () => {
      const result = await receivePurchaseOrderLinesAction({
        purchaseOrderId,
        operationKey,
        lines: chosen.map((item) => ({
          lineId: item.line.id,
          quantity: item.quantity,
          unitCostDollars:
            (prices[item.line.id] ?? "").trim() || undefined,
        })),
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setOperationKey(`ui-${crypto.randomUUID()}`);
      router.refresh();
    });
  }

  function run(
    action: () => Promise<{ status: string; message?: string }>,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.status === "error") {
        setError(result.message ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card
      title="Order actions"
      description={
        status === "DRAFT"
          ? "Mark the order as placed, or cancel it before ordering."
          : "Record deliveries as they arrive, or cancel the remaining order."
      }
    >
      <div className="flex flex-wrap gap-3">
        {status === "DRAFT" && (
          <Button
            type="button"
            disabled={isPending}
            onClick={() =>
              run(() =>
                markPurchaseOrderOrderedAction(purchaseOrderId),
              )
            }
          >
            Mark as ordered
          </Button>
        )}
        <Button
          type="button"
          variant="danger"
          disabled={isPending}
          onClick={() =>
            run(() => cancelPurchaseOrderAction(purchaseOrderId))
          }
        >
          Cancel order
        </Button>
      </div>

      {status === "ORDERED" && open.length > 0 && (
        <fieldset className="mt-6 space-y-4 border-t border-line pt-4">
          <legend className="font-semibold text-ink">What arrived</legend>
          <p className="text-sm text-ink-soft">
            Enter how many of each item arrived in this delivery. Leave a
            price blank to keep the ordered price or leave it unknown.
            Items tied to a part are added to that part&apos;s stock.
          </p>

          {open.map((line) => (
            <div
              key={line.id}
              className="rounded-card border border-line bg-subtle p-4"
            >
              <p className="mb-3 font-semibold text-ink">
                {line.description}{" "}
                <span className="font-normal text-ink-soft">
                  ({line.outstanding} still to arrive)
                </span>
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id={`arrived-${line.id}`}
                  label={`Arrived: ${line.description}`}
                  type="number"
                  min={0}
                  max={line.outstanding}
                  value={quantities[line.id] ?? ""}
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.id]: event.target.value,
                    }))
                  }
                />
                <Field
                  id={`price-${line.id}`}
                  label={`Price each $: ${line.description}`}
                  type="text"
                  inputMode="decimal"
                  placeholder={
                    line.unitCostKnown
                      ? (line.unitCostCents / 100).toFixed(2)
                      : "unknown"
                  }
                  value={prices[line.id] ?? ""}
                  onChange={(event) =>
                    setPrices((current) => ({
                      ...current,
                      [line.id]: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
          ))}

          <Button type="button" disabled={isPending} onClick={receive}>
            Record what arrived
          </Button>
        </fieldset>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
