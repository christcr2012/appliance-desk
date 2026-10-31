"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ApplianceStatus } from "@prisma/client";
import {
  ALLOWED_APPLIANCE_TRANSITIONS,
  APPLIANCE_STATUS_LABELS,
} from "@/domains/inventory/lifecycle";
import {
  APPLIANCE_PILL,
  AWAY_FOR_REPAIR_PILL,
  applianceSubtitle,
  applianceTitle,
} from "@/domains/inventory/words";
import type { FleetRow } from "@/domains/inventory/fleet-list";
import { Button, Checkbox, Select } from "@/components/ui";
import { OverflowMenu, Sheet, StatusPill } from "@/components/kit";
import { toast } from "@/components/kit/toaster";
import { bulkUpdateApplianceStatusAction } from "./actions";

/**
 * AR-6 section 3: the fleet list. Cards carry the shared words (title,
 * subtitle, pills); the bulk "Change status…" sheet offers only statuses
 * at least one selected appliance can actually move to — and never
 * Retired (fix 3: retiring needs its reason, on the record).
 */
export function FleetList({
  rows,
  canManage = false,
  nextHref = null,
}: {
  rows: FleetRow[];
  canManage?: boolean;
  nextHref?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<ApplianceStatus | "">("");
  const [result, setResult] = useState<{
    updated: number;
    skipped: { applianceId: string; reason: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );

  const allowedStatuses = useMemo(() => {
    const union = new Set<ApplianceStatus>();
    for (const row of selectedRows) {
      for (const status of ALLOWED_APPLIANCE_TRANSITIONS[row.status]) {
        if (status !== "RETIRED") union.add(status);
      }
    }
    return [...union].sort(
      (a, b) => APPLIANCE_STATUS_LABELS[a].localeCompare(APPLIANCE_STATUS_LABELS[b]),
    );
  }, [selectedRows]);

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((previous) =>
      previous.size === rows.length ? new Set() : new Set(rows.map((row) => row.id)),
    );
  }

  function applyBulk() {
    if (!bulkStatus) return;
    setError(null);
    startTransition(async () => {
      let outcome;
      try {
        outcome = await bulkUpdateApplianceStatusAction([...selected], bulkStatus);
      } catch {
        setSheetOpen(false);
        setError("The changes were not confirmed. Check the fleet before retrying — your selection is still here.");
        toast({
          message: "The changes were not confirmed — check the fleet before retrying.",
          tone: "danger",
        });
        return;
      }
      if (outcome.status === "error") {
        setSheetOpen(false);
        setError(outcome.message);
        toast({ message: outcome.message, tone: "danger" });
        return;
      }
      toast({
        message: `${outcome.updated.length} changed, ${outcome.skipped.length} skipped`,
        tone: outcome.skipped.length > 0 ? "attention" : "good",
      });
      setResult({ updated: outcome.updated.length, skipped: outcome.skipped });
      setSelected(new Set(outcome.skipped.map((item) => item.applianceId)));
      setSheetOpen(false);
      router.refresh();
    });
  }

  function title(row: FleetRow): string {
    return applianceTitle({ ...row, applianceType: { name: row.typeName } });
  }

  function where(row: FleetRow): string {
    if (row.custody) {
      return row.custody.city
        ? `With ${row.custody.customerName}, ${row.custody.city}`
        : `With ${row.custody.customerName}`;
    }
    return row.currentLocation ?? "At the shop";
  }

  return (
    <div className="mt-6 space-y-4">
      {canManage && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            disabled={isPending}
            label="Select all on this page"
            checked={selected.size === rows.length && rows.length > 0}
            onChange={toggleAll}
          />
          {selected.size > 0 && (
            <>
              <p className="text-sm font-semibold text-ink">{selected.size} selected</p>
              <Button
                type="button"
                disabled={isPending || allowedStatuses.length === 0}
                onClick={() => {
                  setBulkStatus(allowedStatuses[0] ?? "");
                  setSheetOpen(true);
                }}
              >
                Change status…
              </Button>
              <Button
                type="button"
                variant="quiet"
                disabled={isPending}
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </Button>
            </>
          )}
        </div>
      )}

      {error && (
        <div role="status" className="text-sm text-ink-soft">
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div role="status" className="text-sm text-ink-soft">
          <p>
            {result.updated} changed, {result.skipped.length} skipped.
          </p>
          {result.skipped.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {result.skipped.map((item) => (
                <li key={item.applianceId}>
                  <Link
                    href={`/desk/inventory/${item.applianceId}`}
                    className="font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {rows.find((row) => row.id === item.applianceId)?.assetNumber ?? item.applianceId}
                  </Link>
                  {": "}
                  {item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul
        aria-label="Fleet"
        className="divide-y divide-line rounded-card border border-line bg-surface"
      >
        {rows.map((row) => {
          const pill = APPLIANCE_PILL[row.status];
          return (
            <li key={row.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              {canManage && (
                <div className="shrink-0">
                  <Checkbox
                    disabled={isPending}
                    label={`Select ${row.assetNumber}`}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                </div>
              )}
              <Link
                href={`/desk/inventory/${row.id}`}
                className="min-w-0 flex-1 rounded-control p-1 hover:bg-subtle sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{title(row)}</p>
                  <p className="mt-1 text-sm text-ink-soft">{applianceSubtitle({ ...row, applianceType: { name: row.typeName } })}</p>
                </div>
                <p className="mt-2 text-sm text-ink-soft sm:mt-0">{where(row)}</p>
                <span className="mt-3 flex flex-wrap gap-2 sm:mt-0 sm:justify-end">
                  <StatusPill
                    label={pill.label}
                    tone={pill.tone}
                    info={row.status === "AWAITING_INSPECTION" ? "awaiting-inspection" : undefined}
                  />
                  {row.awayForRepair && (
                    <StatusPill label={AWAY_FOR_REPAIR_PILL.label} tone={AWAY_FOR_REPAIR_PILL.tone} info="away-for-repair" />
                  )}
                </span>
              </Link>
              <OverflowMenu
                label={`More for ${title(row)}`}
                items={[
                  { kind: "link", label: "Open", href: `/desk/inventory/${row.id}` },
                  { kind: "link", label: "Print QR label", href: `/desk/inventory/${row.id}/qr` },
                  ...(canManage
                    ? [
                        { kind: "link", label: "Start a repair…", href: `/desk/inventory/${row.id}` } as const,
                        { kind: "link", label: "Retire…", href: `/desk/inventory/${row.id}` } as const,
                      ]
                    : []),
                ]}
              />
            </li>
          );
        })}
      </ul>

      {nextHref && (
        <div className="flex justify-center">
          <Link
            href={nextHref}
            className="rounded-control border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-subtle"
          >
            Load more
          </Link>
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Change status">
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">
            {selected.size} selected. Only the statuses at least one of them can move to are
            offered — Retired is never one of them, because retiring keeps a reason on the
            appliance record.
          </p>
          <Select
            label="Set status to"
            value={bulkStatus}
            onChange={(event) => setBulkStatus(event.target.value as ApplianceStatus)}
          >
            {allowedStatuses.map((status) => (
              <option key={status} value={status}>
                {APPLIANCE_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
          <div className="flex gap-3">
            <Button type="button" disabled={isPending || !bulkStatus} onClick={applyBulk}>
              {isPending ? "Applying…" : "Apply"}
            </Button>
            <Button type="button" variant="quiet" disabled={isPending} onClick={() => setSheetOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
