"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, Field } from "@/components/ui";
import { splitOldSetApplianceAction, type SplitState } from "./actions";

type Part = { applianceTypeId: string; name: string };
type Details = { manufacturer: string; model: string; serialNumber: string };

export function SplitForm({
  applianceId,
  assetNumber,
  parts,
  current,
}: {
  applianceId: string;
  assetNumber: string;
  parts: Part[];
  current: Details;
}) {
  const [details, setDetails] = useState<Details[]>(
    parts.map((_, index) => (index === 0 ? { ...current } : { manufacturer: current.manufacturer, model: "", serialNumber: "" })),
  );
  const [state, setState] = useState<SplitState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const update = (index: number, patch: Partial<Details>) =>
    setDetails((all) => all.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  if (state.status === "success") {
    return (
      <div role="status" className="space-y-3">
        <p className="font-medium text-success">{state.message}</p>
        <ul className="list-disc pl-5 text-sm">
          <li>
            <Link href={`/desk/inventory/${applianceId}`} className="underline hover:text-primary">{assetNumber}</Link>
          </li>
          {state.created.map((m) => (
            <li key={m.id}>
              <Link href={`/desk/inventory/${m.id}`} className="underline hover:text-primary">{m.assetNumber}</Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          try {
            setState(
              await splitOldSetApplianceAction(
                applianceId,
                parts.map((part, index) => ({ applianceTypeId: part.applianceTypeId, ...details[index] })),
              ),
            );
          } catch {
            setState({ status: "error", message: "The split was not confirmed. Reload to check before trying again." });
          }
        });
      }}
    >
      {parts.map((part, index) => (
        <fieldset key={index} className="space-y-3 rounded-card border border-line p-4">
          <legend className="px-1 font-semibold text-ink">
            {part.name} {index === 0 ? `(keeps ${assetNumber} and its history)` : "(new asset number)"}
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`${part.name} make`} value={details[index]!.manufacturer} onChange={(e) => update(index, { manufacturer: e.target.value })} />
            <Field label={`${part.name} model`} value={details[index]!.model} onChange={(e) => update(index, { model: e.target.value })} />
            <Field
              label={`${part.name} serial number`}
              value={details[index]!.serialNumber}
              onChange={(e) => update(index, { serialNumber: e.target.value })}
            />
          </div>
        </fieldset>
      ))}
      {state.status === "error" && (
        <p role="alert" className="text-sm font-medium text-danger">{state.message}</p>
      )}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Splitting…" : "Split into separate machines"}
      </Button>
    </form>
  );
}
