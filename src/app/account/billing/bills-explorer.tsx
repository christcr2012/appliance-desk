"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/kit/status-pill";
import { EmptyState } from "@/components/kit/empty-state";
import { InfoNote } from "@/components/portal/info-note";
import type { Tone } from "@/components/kit/types";

export type BillRow = {
  id: string;
  number: number;
  propertyId: string;
  propertyLabel: string;
  statusLabel: string;
  statusTone: Tone;
  amountText: string;
  paidText: string | null;
  dueText: string | null;
  dueLate: boolean;
  tab: "topay" | "paid";
  payNowEligible: boolean;
  payAsArranged: boolean;
};

export type BillsLabels = {
  bills: string;
  bill: string;
  toPay: string;
  paidTab: string;
  property: string;
  allProperties: string;
  payNow: string;
  payAsArranged: string;
  noBillsToPay: string;
  noPaidBills: string;
};

/**
 * PORTAL-1 section 5.4: the Bills list filters the already-loaded
 * statement in the browser — To pay / Paid tabs and the property
 * select never round-trip. All amounts, due lines and pay eligibility
 * are computed by the server (domain rules); this component only
 * filters rows and renders them. Pay now stays a native POST form to
 * the existing pay route.
 */
export function BillsExplorer({
  rows,
  properties,
  labels,
}: {
  rows: BillRow[];
  properties: { id: string; label: string }[];
  labels: BillsLabels;
}) {
  const [tab, setTab] = useState<"topay" | "paid">("topay");
  const [propertyId, setPropertyId] = useState<string>("all");

  const counts = useMemo(
    () => ({
      topay: rows.filter((row) => row.tab === "topay").length,
      paid: rows.filter((row) => row.tab === "paid").length,
    }),
    [rows],
  );
  const shown = rows.filter(
    (row) => row.tab === tab && (propertyId === "all" || row.propertyId === propertyId),
  );

  const tabButton = (value: "topay" | "paid", label: string, count: number) => {
    const isCurrent = tab === value;
    return (
      <li className="shrink-0">
        <button
          type="button"
          aria-pressed={isCurrent}
          onClick={() => setTab(value)}
          className={`relative inline-flex h-9 items-center before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] gap-1.5 rounded-full px-3.5 text-sm font-bold whitespace-nowrap lg:rounded-field ${
            isCurrent
              ? "bg-primary text-on-primary lg:bg-surface lg:text-ink lg:shadow-sm"
              : "border border-line bg-surface text-ink hover:bg-tint lg:border-transparent lg:bg-transparent lg:text-ink-soft"
          }`}
        >
          {label} <span className="tabular-nums">{count}</span>
        </button>
      </li>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav aria-label={labels.bills} className="-mx-4 sm:-mx-6 lg:mx-0">
          <ul className="flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:px-6 lg:inline-flex lg:gap-1 lg:overflow-visible lg:rounded-field lg:bg-tint lg:p-1 [&::-webkit-scrollbar]:hidden">
            {tabButton("topay", labels.toPay, counts.topay)}
            {tabButton("paid", labels.paidTab, counts.paid)}
          </ul>
        </nav>
        {properties.length > 1 && (
          <div className="flex items-center gap-2">
            <label htmlFor="bills-property" className="text-sm font-semibold text-ink">
              {labels.property}
            </label>
            <select
              id="bills-property"
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
              className="min-h-11 rounded-field border border-line bg-surface px-2 text-sm text-ink"
            >
              <option value="all">{labels.allProperties}</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={tab === "topay" ? labels.noBillsToPay : labels.noPaidBills} />
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {shown.map((row) => (
            <li key={row.id} className="rounded-card border border-line bg-surface px-4 py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/account/billing/invoice/${row.id}`}
                      className="font-semibold text-ink underline-offset-4 hover:underline"
                    >
                      {labels.bill} #{row.number}
                    </Link>
                    <StatusPill label={row.statusLabel} tone={row.statusTone} />
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">{row.propertyLabel}</p>
                  {row.dueText && (
                    <p className={`mt-1 text-sm ${row.dueLate ? "font-semibold text-warning-ink" : "text-ink-soft"}`}>
                      {row.dueText}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-lg font-extrabold tabular-nums text-ink">{row.amountText}</p>
                  {row.paidText && <p className="mt-0.5 text-sm text-ink-soft">{row.paidText}</p>}
                  {row.payNowEligible && (
                    <form method="post" action={`/account/billing/invoice/${row.id}/pay`} className="mt-2">
                      <button
                        type="submit"
                        className="inline-flex min-h-11 items-center rounded-control bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-dark"
                      >
                        {labels.payNow}
                      </button>
                    </form>
                  )}
                  {row.payAsArranged && (
                    <span className="mt-1 inline-flex">
                      <InfoNote label={labels.payAsArranged} text={labels.payAsArranged} />
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
