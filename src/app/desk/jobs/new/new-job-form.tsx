"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createJobAction, type ScheduleConflictView } from "../actions";
import { ScheduleConflictNotice } from "../schedule-conflicts";

type CustomerOption = {
  id: string;
  name: string;
  serviceAddresses: { id: string; label: string }[];
};

type AgreementContext = {
  id: string;
  customerId: string;
  serviceAddressId: string;
  appliances: { id: string; label: string }[];
};

type MaintenanceContext = {
  maintenanceRequestId: string;
  customerId: string;
  customerName: string;
  serviceAddresses: { id: string; label: string }[];
  appliances: { id: string; label: string }[];
  defaultApplianceId: string | null;
};

const JOB_TYPES: { value: string; label: string }[] = [
  { value: "DELIVERY", label: "Delivery" },
  { value: "INSTALLATION", label: "Installation" },
  { value: "SWAP", label: "Swap" },
  { value: "MAINTENANCE_VISIT", label: "Maintenance visit" },
  { value: "REMOVAL", label: "Removal" },
];

export function NewJobForm({
  customers,
  agreement,
  maintenanceContext,
  initialCustomerId,
  initialServiceAddressId,
  teamMembers = [],
}: {
  customers: CustomerOption[];
  agreement: AgreementContext | null;
  maintenanceContext?: MaintenanceContext | null;
  /** Preselects a customer from a plain link (e.g. the "Schedule a job"
   * quick action on their own /desk/customers/[id] page) — distinct from
   * agreement/maintenanceContext, which also carry a service address and
   * (for maintenanceContext) appliance options along with the customer. */
  initialCustomerId?: string;
  initialServiceAddressId?: string;
  teamMembers?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState(
    agreement ? "DELIVERY" : "MAINTENANCE_VISIT",
  );
  const [customerId, setCustomerId] = useState(
    agreement?.customerId ??
      maintenanceContext?.customerId ??
      initialCustomerId ??
      customers[0]?.id ??
      "",
  );
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const [serviceAddressId, setServiceAddressId] = useState(
    agreement?.serviceAddressId ??
      maintenanceContext?.serviceAddresses[0]?.id ??
      (selectedCustomer?.serviceAddresses.some(
        (a) => a.id === initialServiceAddressId,
      )
        ? initialServiceAddressId
        : undefined) ??
      selectedCustomer?.serviceAddresses[0]?.id ??
      "",
  );
  const [scheduledAt, setScheduledAt] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [durationText, setDurationText] = useState("");
  const [conflicts, setConflicts] = useState<ScheduleConflictView[]>([]);
  const [notes, setNotes] = useState("");
  const [selectedApplianceIds, setSelectedApplianceIds] = useState<string[]>(
    agreement?.appliances.map((a) => a.id) ??
      (maintenanceContext?.defaultApplianceId
        ? [maintenanceContext.defaultApplianceId]
        : []),
  );
  const [error, setError] = useState<string | null>(null);

  function toggleAppliance(id: string) {
    setSelectedApplianceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleCustomerChange(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    setServiceAddressId(c?.serviceAddresses[0]?.id ?? "");
  }

  function submit(confirmedConflictJobIds: string[]) {
    setError(null);
    const durationMinutes = durationText.trim() === "" ? null : Number(durationText.trim());
    if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 720)) {
      setError("Visit length: enter a whole number of minutes between 15 and 720, or leave it blank for the usual length.");
      return;
    }
    startTransition(async () => {
      const result = await createJobAction({
        type,
        scheduledAt,
        customerId,
        serviceAddressId,
        agreementId: agreement?.id ?? "",
        maintenanceRequestId: maintenanceContext?.maintenanceRequestId ?? "",
        applianceIds: selectedApplianceIds,
        notes,
        assignedToUserId,
        durationMinutes,
        confirmedConflictJobIds,
      });
      if (result.status === "conflict") {
        setConflicts(result.conflicts);
      } else if (result.status === "error") {
        setConflicts([]);
        setError(result.message);
      } else {
        router.push(`/desk/jobs/${result.jobId}`);
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit([]);
  }

  const addresses = selectedCustomer?.serviceAddresses ?? [];

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-5"
    >
      <div>
        <label
          htmlFor="type"
          className="block text-sm font-medium text-gray-700"
        >
          Job type
        </label>
        <select
          id="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {JOB_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="scheduledAt"
          className="block text-sm font-medium text-gray-700"
        >
          When (optional)
        </label>
        <input
          id="scheduledAt"
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => {
            setScheduledAt(e.target.value);
            setConflicts([]);
          }}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="assignedToUserId" className="block text-sm font-medium text-gray-700">
          Who is doing it (optional)
        </label>
        <select
          id="assignedToUserId"
          value={assignedToUserId}
          onChange={(e) => {
            setAssignedToUserId(e.target.value);
            setConflicts([]);
          }}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Nobody assigned yet</option>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="durationMinutes" className="block text-sm font-medium text-gray-700">
          How long it takes, in minutes (optional)
        </label>
        <input
          id="durationMinutes"
          type="text"
          inputMode="numeric"
          value={durationText}
          onChange={(e) => {
            setDurationText(e.target.value);
            setConflicts([]);
          }}
          className="mt-1 w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-gray-500">Leave blank to use your usual visit length (Settings → Visits and scheduling).</p>
      </div>

      {conflicts.length > 0 && (
        <ScheduleConflictNotice conflicts={conflicts} disabled={isPending} onConfirm={(ids) => submit(ids)} />
      )}

      {maintenanceContext && !agreement && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          For {maintenanceContext.customerName}&apos;s maintenance request.{" "}
          <Link
            href={`/desk/maintenance/${maintenanceContext.maintenanceRequestId}`}
            className="text-primary hover:underline"
          >
            View the request
          </Link>
        </div>
      )}

      {!agreement && !maintenanceContext && (
        <>
          <div>
            <label
              htmlFor="customerId"
              className="block text-sm font-medium text-gray-700"
            >
              Customer (optional)
            </label>
            <select
              id="customerId"
              value={customerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No specific customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {addresses.length > 0 && (
            <div>
              <label
                htmlFor="serviceAddressId"
                className="block text-sm font-medium text-gray-700"
              >
                Service address
              </label>
              <select
                id="serviceAddressId"
                value={serviceAddressId}
                onChange={(e) => setServiceAddressId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {maintenanceContext && maintenanceContext.serviceAddresses.length > 0 && (
        <div>
          <label
            htmlFor="serviceAddressId"
            className="block text-sm font-medium text-gray-700"
          >
            Service address
          </label>
          <select
            id="serviceAddressId"
            value={serviceAddressId}
            onChange={(e) => setServiceAddressId(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {maintenanceContext.serviceAddresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {agreement && agreement.appliances.length > 0 && (
        <div>
          <p className="block text-sm font-medium text-gray-700">
            Appliances on this agreement
          </p>
          <div className="mt-2 space-y-1 rounded-md border border-gray-200 p-2">
            {agreement.appliances.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedApplianceIds.includes(a.id)}
                  onChange={() => toggleAppliance(a.id)}
                />
                {a.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {maintenanceContext && maintenanceContext.appliances.length > 0 && (
        <div>
          <p className="block text-sm font-medium text-gray-700">
            This customer&apos;s appliances
          </p>
          <div className="mt-2 space-y-1 rounded-md border border-gray-200 p-2">
            {maintenanceContext.appliances.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedApplianceIds.includes(a.id)}
                  onChange={() => toggleAppliance(a.id)}
                />
                {a.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <label
          htmlFor="notes"
          className="block text-sm font-medium text-gray-700"
        >
          Notes (optional)
        </label>
        <textarea
          id="notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Scheduling…" : "Schedule job"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
