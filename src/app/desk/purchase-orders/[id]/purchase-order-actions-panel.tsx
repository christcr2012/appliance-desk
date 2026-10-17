"use client";
import { moneyInputValue } from "@/lib/money-ui";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Select } from "@/components/ui";
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
  isOwner = false,
}: {
  purchaseOrderId: string;
  status: "DRAFT" | "ORDERED";
  lines?: ReceivableLine[];
  isOwner?: boolean;
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
  // No default for the owner: the tax question must be answered on purpose. An admin always defers it.
  const [taxAnswer, setTaxAnswer] = useState(isOwner ? "" : "LATER");
  const [sellerTax, setSellerTax] = useState("");
  const [otherState, setOtherState] = useState("");
  const taxed = taxAnswer === "YES_COLORADO" || taxAnswer === "YES_OTHER_STATE";

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

    if (!taxAnswer) {
      setError("Answer the tax question before recording the delivery.");
      return;
    }

    startTransition(async () => {
      const result = await receivePurchaseOrderLinesAction({
        purchaseOrderId,
        operationKey,
        taxAnswer,
        sellerTax: taxed ? sellerTax : "",
        otherState: taxAnswer === "YES_OTHER_STATE" ? otherState : "",
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
                      ? moneyInputValue(line.unitCostCents)
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

          {isOwner ? (
            <div className="space-y-3 rounded-card border border-line p-4">
              <Select id="receipt-tax-answer" label="Did the seller charge sales tax on these parts?" value={taxAnswer} onChange={(e) => setTaxAnswer(e.target.value)}>
                <option value="" disabled>Choose one…</option>
                <option value="YES_COLORADO">Yes — Colorado sales tax</option>
                <option value="YES_OTHER_STATE">Yes — another state&apos;s tax</option>
                <option value="NO">No tax was charged</option>
                <option value="LATER">I&apos;ll check the receipt later</option>
              </Select>
              {taxed && <Field id="receipt-seller-tax" label="Total tax printed on the receipt ($)" inputMode="decimal" value={sellerTax} onChange={(e) => setSellerTax(e.target.value)} />}
              {taxAnswer === "YES_OTHER_STATE" && <Field id="receipt-other-state" label="Which state?" value={otherState} onChange={(e) => setOtherState(e.target.value)} />}
            </div>
          ) : (
            <p className="text-sm text-ink-soft">Only the owner can answer the tax question. This delivery will be saved as “check the receipt later” and appear on the owner&apos;s To do list.</p>
          )}

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
