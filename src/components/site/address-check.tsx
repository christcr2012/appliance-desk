"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field } from "@/components/ui";
import { checkServiceAddress, type AddressCheckState } from "@/app/(public)/check-address-actions";

/** Fills {zone} and {price} only (the other placeholders were filled on the server). */
function fill(text: string, values: { zone: string; price: string }): string {
  return text.replace(/\{(zone|price)\}/g, (_whole, name: "zone" | "price") => values[name]);
}

export type AddressCheckCopy = {
  addressLabel: string;
  zipLabel: string;
  button: string;
  /** "…{zone}… {price}…" — a zone with a price, when website prices are on. */
  served: string;
  /** "…{zone}…" — the free zone. */
  servedFree: string;
  /** "…{zone}…" — a zone with a price while website prices are hidden. */
  servedNoPrice: string;
  servedLink: string;
  notYet: string;
  notYetLink: string;
  unknown: string;
  invalid: string;
  limited: string;
};

const IDLE: AddressCheckState = { status: "idle" };

/** The quote page address with the visitor's own street and ZIP filled in (in the link only; nothing is saved). */
function withAddress(base: string, line1: string, zip: string): string {
  if (!base.startsWith("/")) return base;
  const query = new URLSearchParams({ address: line1, zip });
  return `${base}${base.includes("?") ? "&" : "?"}${query.toString()}`;
}

/**
 * ZONE-1: "which delivery zone am I in?" on the home and service-area pages. The answer comes from the owner's zones
 * (see check-address-actions.ts); the address is read, answered and dropped. Works as a plain form without JavaScript.
 */
export function AddressCheck({ copy, quoteHref, id = "address-check" }: { copy: AddressCheckCopy; quoteHref: string; id?: string }) {
  const [state, action, pending] = useActionState(checkServiceAddress, IDLE);
  const served = state.status === "SERVED"
    ? fill(state.free ? copy.servedFree : state.price ? copy.served : copy.servedNoPrice,
      { zone: state.zone, price: state.price ?? "" })
    : "";
  return (
    <div className="max-w-xl">
      <form action={action} className="rounded-card border border-hairline bg-surface p-3 shadow-raise sm:p-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field id={`${id}-line1`} label={copy.addressLabel} name="line1" autoComplete="street-address" maxLength={200} required />
          <Field id={`${id}-zip`} label={copy.zipLabel} name="zip" inputMode="numeric" autoComplete="postal-code" maxLength={10} required />
        </div>
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" defaultValue="" />
        <Button type="submit" size="lg" disabled={pending} className="cut-corner-sm signature-lift mt-4 w-full sm:w-auto">
          {copy.button}
        </Button>
      </form>
      <div role="status" aria-live="polite" className="mt-3 min-h-6 text-sm">
        {state.status === "SERVED" && (
          <p className="font-semibold text-ink">
            {served}{" "}
            <Link className="underline" href={withAddress(quoteHref, state.line1, state.zip)}>{copy.servedLink}</Link>
          </p>
        )}
        {state.status === "OUTSIDE" && (
          <p className="font-semibold text-ink">
            {copy.notYet} <Link className="underline" href={withAddress(quoteHref, state.line1, state.zip)}>{copy.notYetLink}</Link>
          </p>
        )}
        {state.status === "UNKNOWN" && (
          <p className="font-semibold text-ink">
            {copy.unknown} <Link className="underline" href={withAddress(quoteHref, state.line1, state.zip)}>{copy.servedLink}</Link>
          </p>
        )}
        {state.status === "INVALID" && <p role="alert" className="font-semibold text-danger">{copy.invalid}</p>}
        {state.status === "LIMITED" && <p role="alert" className="font-semibold text-danger">{copy.limited}</p>}
      </div>
    </div>
  );
}
