"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select, Textarea } from "@/components/ui";
import { createPurchaseOrderAction } from "../../purchasing-actions";

type LineDraft = {
  partRecordId: string;
  description: string;
  quantity: string;
  unitCostDollars: string;
};

function emptyLine(): LineDraft {
  return {
    partRecordId: "",
    description: "",
    quantity: "1",
    unitCostDollars: "",
  };
}

export function NewPurchaseOrderForm({
  suppliers,
  partRecords,
}: {
  suppliers: { id: string; name: string }[];
  partRecords: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((previous) =>
      previous.map((line, current) =>
        current === index ? { ...line, ...patch } : line,
      ),
    );
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createPurchaseOrderAction({
        supplierId,
        notes,
        lines: lines.map((line) => ({
          partRecordId: line.partRecordId || undefined,
          description: line.description,
          quantity: line.quantity,
          unitCostDollars: line.unitCostDollars || undefined,
        })),
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      if (result.status === "success" && result.id) {
        router.push(`/desk/purchase-orders/${result.id}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Select
        id="po-supplier"
        label="Supplier"
        value={supplierId}
        onChange={(event) => setSupplierId(event.target.value)}
      >
        {suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.name}
          </option>
        ))}
      </Select>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">Lines</legend>
        {lines.map((line, index) => (
          <div
            key={index}
            className="space-y-3 rounded-card border border-line bg-subtle p-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                id={`po-line-${index}-part`}
                label="Part on file (optional)"
                value={line.partRecordId}
                onChange={(event) =>
                  updateLine(index, { partRecordId: event.target.value })
                }
              >
                <option value="">— Not in the parts catalog —</option>
                {partRecords.map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.label}
                  </option>
                ))}
              </Select>
              <Field
                id={`po-line-${index}-description`}
                label="Description"
                required
                value={line.description}
                onChange={(event) =>
                  updateLine(index, { description: event.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field
                id={`po-line-${index}-quantity`}
                label="Quantity"
                type="number"
                min={1}
                required
                value={line.quantity}
                onChange={(event) =>
                  updateLine(index, { quantity: event.target.value })
                }
              />
              <Field
                id={`po-line-${index}-cost`}
                label="Unit cost ($)"
                type="number"
                min={0}
                step="0.01"
                value={line.unitCostDollars}
                onChange={(event) =>
                  updateLine(index, { unitCostDollars: event.target.value })
                }
              />
              {lines.length > 1 && (
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="quiet"
                    className="text-danger"
                    onClick={() =>
                      setLines((previous) =>
                        previous.filter(
                          (_, current) => current !== index,
                        ),
                      )
                    }
                  >
                    Remove line
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setLines((previous) => [...previous, emptyLine()])
          }
        >
          + Add another line
        </Button>
      </fieldset>

      <Textarea
        id="po-notes"
        label="Notes"
        rows={2}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create purchase order"}
      </Button>

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
