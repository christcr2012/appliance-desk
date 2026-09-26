"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMaintenanceRequestAction } from "./actions";

type ApplianceOption = { id: string; label: string };

const PRIORITIES: { value: string; label: string }[] = [
  { value: "LOW", label: "Low — whenever's convenient" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High — affecting daily use" },
  { value: "URGENT", label: "Urgent — safety issue or completely unusable" },
];

export function NewRequestForm({ appliances }: { appliances: ApplianceOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [problem, setProblem] = useState("");
  const [applianceId, setApplianceId] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createMaintenanceRequestAction({
        problem,
        applianceId,
        priority,
      });
      if (result.status === "error") {
        setError(result.message);
      } else {
        setProblem("");
        setApplianceId("");
        setPriority("NORMAL");
        setSuccess(true);
        router.refresh();
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-5"
    >
      <h2 className="font-medium text-gray-900">Report a problem</h2>

      {appliances.length > 0 && (
        <div>
          <label htmlFor="applianceId" className="block text-sm font-medium text-gray-700">
            Which appliance? (optional)
          </label>
          <select
            id="applianceId"
            value={applianceId}
            onChange={(e) => setApplianceId(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Not sure / general question</option>
            {appliances.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="problem" className="block text-sm font-medium text-gray-700">
          What&apos;s going on?
        </label>
        <textarea
          id="problem"
          rows={4}
          required
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="priority" className="block text-sm font-medium text-gray-700">
          How urgent is this?
        </label>
        <select
          id="priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Submitting…" : "Submit request"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {success && !error && (
        <p className="text-sm text-green-700">
          Got it — we&apos;ll be in touch about next steps.
        </p>
      )}
    </form>
  );
}
