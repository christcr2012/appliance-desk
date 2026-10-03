"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addRentalLineAction,
  removeRentalLineAction,
  sendForSignatureAction,
  endAgreementAction,
  cancelAgreementAction,
  extendReservationAction,
} from "../actions";
import { formatCents } from "@/domains/pricing/money";
import { isReservationStale } from "@/domains/agreements/reservation-status";
import type { RentalAgreementStatus } from "@prisma/client";

type ApplianceOption = { id: string; assetNumber: string; typeName: string };

type LineRow = {
  id: string;
  label: string;
  monthlyPriceCents: number;
  listPriceCents: number;
  prepayDiscountCentsPerMonth: number;
  assignments: {
    appliance: { id: string; assetNumber: string; applianceType: { name: string } };
  }[];
};

type AgreementRow = {
  id: string;
  status: RentalAgreementStatus;
  depositCents: number;
  damageWaiverCents: number;
  termMonths: number | null;
  startDate: Date | null;
  paidInFullInAdvance: boolean;
  freeMonthGranted: boolean;
  reservationExpiresAt: Date | null;
  lines: LineRow[];
  signature: {
    id: string;
    signedAt: Date | null;
    signerName: string | null;
    signerEmail: string | null;
  } | null;
  jobs: { id: string; type: string; status: string }[];
};

export function AgreementDetailPanel({
  agreement,
  availableAppliances,
}: {
  agreement: AgreementRow;
  availableAppliances: ApplianceOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [listPriceDollars, setListPriceDollars] = useState("");
  const [selectedApplianceIds, setSelectedApplianceIds] = useState<string[]>([]);

  function toggleAppliance(id: string) {
    setSelectedApplianceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleAddLine(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addRentalLineAction(agreement.id, {
        label,
        listPriceDollars,
        applianceIds: selectedApplianceIds,
      });
      if (result.status === "error") {
        setError(result.message);
      } else {
        setLabel("");
        setListPriceDollars("");
        setSelectedApplianceIds([]);
        router.refresh();
      }
    });
  }

  function handleRemoveLine(lineId: string) {
    startTransition(async () => {
      const result = await removeRentalLineAction(agreement.id, lineId);
      if (result.status === "error") setError(result.message);
      router.refresh();
    });
  }

  function handleSendForSignature() {
    setError(null);
    startTransition(async () => {
      const result = await sendForSignatureAction(agreement.id);
      if (result.status === "error") setError(result.message);
      router.refresh();
    });
  }

  function handleEnd() {
    startTransition(async () => {
      const result = await endAgreementAction(agreement.id);
      if (result.status === "error") setError(result.message);
      router.refresh();
    });
  }

  function handleCancel() {
    if (!confirm("Cancel this agreement? Any assigned appliances go back to available.")) return;
    startTransition(async () => {
      const result = await cancelAgreementAction(agreement.id);
      if (result.status === "error") setError(result.message);
      router.refresh();
    });
  }

  function handleExtendReservation() {
    startTransition(async () => {
      const result = await extendReservationAction(agreement.id);
      if (result.status === "error") setError(result.message);
      router.refresh();
    });
  }

  const monthlyTotal = agreement.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0);
  const stale = isReservationStale(agreement.status, agreement.reservationExpiresAt);
  const signLink =
    typeof window !== "undefined" && agreement.signature
      ? `${window.location.origin}/sign/${agreement.signature.id}`
      : null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium text-gray-900">
            Status:{" "}
            {agreement.status === "SCHEDULED"
              ? `Signed, starts ${agreement.startDate ? new Date(agreement.startDate).toLocaleDateString() : "later"}`
              : agreement.status}
          </h2>
          <div className="flex gap-2">
            {agreement.status === "DRAFT" && (
              <button
                type="button"
                disabled={isPending || agreement.lines.length === 0}
                onClick={handleSendForSignature}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                Send for signature
              </button>
            )}
            {agreement.status === "ACTIVE" && (
              <button
                type="button"
                disabled={isPending}
                onClick={handleEnd}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400 disabled:opacity-50"
              >
                Mark ended
              </button>
            )}
            {(agreement.status === "DRAFT" ||
              agreement.status === "AWAITING_SIGNATURE" ||
              agreement.status === "SCHEDULED" ||
              agreement.status === "ACTIVE") && (
              <button
                type="button"
                disabled={isPending}
                onClick={handleCancel}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:border-red-400 disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <p className="mt-2 text-sm text-gray-600">
          {agreement.termMonths ? `${agreement.termMonths}-month term` : "Month-to-month"}
          {agreement.depositCents > 0 && ` · Deposit ${formatCents(agreement.depositCents)}`}
          {agreement.damageWaiverCents > 0 &&
            ` · Damage waiver ${formatCents(agreement.damageWaiverCents)} once at signing`}
          {agreement.paidInFullInAdvance && " · Paid in full, in advance"}
        </p>

        {agreement.freeMonthGranted && (
          <div className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-900">
            This customer paid the full 12-month term in advance, so their first month
            is free.
          </div>
        )}

        {stale && (
          <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">
              This agreement&apos;s reserved appliances have been on hold since{" "}
              {agreement.reservationExpiresAt
                ? new Date(agreement.reservationExpiresAt).toLocaleDateString()
                : "a while ago"}{" "}
              — longer than the usual hold period.
            </p>
            <p className="mt-1">
              If this deal has stalled, cancel it to free the appliance(s) back up
              for another customer. If it&apos;s just taking a while, extend the
              hold instead.
            </p>
            <button
              type="button"
              disabled={isPending}
              onClick={handleExtendReservation}
              className="mt-2 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:border-amber-500 disabled:opacity-50"
            >
              Extend reservation
            </button>
          </div>
        )}

        {agreement.status === "AWAITING_SIGNATURE" && agreement.signature && (
          <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Waiting on the customer&apos;s signature.</p>
            <p className="mt-1">
              Send them this link to review and sign (no login needed):
            </p>
            <p className="mt-1 break-all font-mono text-xs">
              {signLink ?? `/sign/${agreement.signature.id}`}
            </p>
          </div>
        )}

        {agreement.signature?.signedAt && (
          <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-900">
            Signed by {agreement.signature.signerName} (
            {agreement.signature.signerEmail}) on{" "}
            {new Date(agreement.signature.signedAt).toLocaleString()}.
          </div>
        )}

        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">
          Appliances ({formatCents(monthlyTotal)}/mo total)
        </h2>

        {agreement.lines.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No appliances added yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {agreement.lines.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-4 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {line.label} — {formatCents(line.monthlyPriceCents)}/mo
                  </p>
                  {line.prepayDiscountCentsPerMonth > 0 && (
                    <p className="text-sm text-primary">
                      {formatCents(line.listPriceCents)}/mo list price −{" "}
                      {formatCents(line.prepayDiscountCentsPerMonth)}/mo term discount
                    </p>
                  )}
                  <p className="text-sm text-gray-600">
                    {line.assignments
                      .map((a) => `${a.appliance.applianceType.name} (${a.appliance.assetNumber})`)
                      .join(", ")}
                  </p>
                </div>
                {agreement.status === "DRAFT" && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleRemoveLine(line.id)}
                    className="shrink-0 text-sm text-red-700 hover:underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {agreement.status === "DRAFT" && (
          <form onSubmit={handleAddLine} className="mt-4 space-y-3 border-t border-gray-100 pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="lineLabel" className="block text-sm font-medium text-gray-700">
                  Label
                </label>
                <input
                  id="lineLabel"
                  type="text"
                  required
                  placeholder="e.g. Washer/Dryer set"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="listPriceDollars"
                  className="block text-sm font-medium text-gray-700"
                >
                  Monthly price before any discount ($)
                </label>
                <input
                  id="listPriceDollars"
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={listPriceDollars}
                  onChange={(e) => setListPriceDollars(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                {agreement.termMonths === 6 || agreement.termMonths === 12 ? (
                  <p className="mt-1 text-xs text-gray-500">
                    This agreement&apos;s {agreement.termMonths}-month prepay discount is
                    applied automatically.
                  </p>
                ) : null}
              </div>
            </div>

            <div>
              <p className="block text-sm font-medium text-gray-700">
                Which appliance(s)? (select 2 for a set — sets get the higher prepay
                discount rate)
              </p>
              {availableAppliances.length === 0 ? (
                <p className="mt-1 text-sm text-gray-600">
                  No available appliances in inventory right now.
                </p>
              ) : (
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2">
                  {availableAppliances.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedApplianceIds.includes(a.id)}
                        onChange={() => toggleAppliance(a.id)}
                      />
                      {a.typeName} ({a.assetNumber})
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isPending || availableAppliances.length === 0}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {isPending ? "Adding…" : "Add to agreement"}
            </button>
          </form>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-gray-900">Jobs</h2>
          {agreement.status === "ACTIVE" && (
            <Link
              href={`/desk/jobs/new?agreementId=${agreement.id}`}
              className="text-sm text-primary hover:underline"
            >
              + Schedule a job
            </Link>
          )}
        </div>
        {agreement.jobs.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No jobs scheduled yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {agreement.jobs.map((j) => (
              <li key={j.id}>
                <Link href={`/desk/jobs/${j.id}`} className="hover:underline">
                  {j.type} — {j.status}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
