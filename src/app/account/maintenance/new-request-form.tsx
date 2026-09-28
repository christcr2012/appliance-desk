"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMaintenanceRequestAction } from "./actions";
import { PhotoUploadField } from "@/components/photo-upload-field";

type ApplianceOption = { id: string; label: string };

const PRIORITIES: { value: string; label: string }[] = [
  { value: "LOW", label: "Low — whenever's convenient" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High — affecting daily use" },
  { value: "URGENT", label: "Urgent — safety issue or completely unusable" },
];

export function NewRequestForm({
  appliances,
  initialApplianceId = "",
}: {
  appliances: ApplianceOption[];
  initialApplianceId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [problem, setProblem] = useState("");
  const [applianceId, setApplianceId] = useState(initialApplianceId);
  const [priority, setPriority] = useState("NORMAL");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const MAX_PHOTOS = 6;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createMaintenanceRequestAction({
        problem,
        applianceId,
        priority,
        photoUrls,
      });
      if (result.status === "error") {
        setError(result.message);
      } else {
        setProblem("");
        setApplianceId("");
        setPriority("NORMAL");
        setPhotoUrls([]);
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

      <div>
        <span className="block text-sm font-medium text-gray-700">Photo (optional)</span>
        <p className="mt-1 text-xs text-gray-500">
          A picture of the problem — a leak, a broken part, anything that helps.
        </p>
        {photoUrls.length > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {photoUrls.map((url) => (
              <div key={url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="Photo of the problem"
                  className="h-16 w-16 rounded-md object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPhotoUrls((urls) => urls.filter((u) => u !== url))}
                  aria-label="Remove this photo"
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-xs text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {photoUrls.length < MAX_PHOTOS && (
          <div className="mt-2">
            <PhotoUploadField
              pathPrefix="maintenance-requests"
              label="Add a photo"
              onUploaded={(url) => {
                setPhotoError(null);
                setPhotoUrls((urls) => [...urls, url]);
              }}
              onError={(message) => setPhotoError(message)}
            />
          </div>
        )}
        {photoError && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {photoError}
          </p>
        )}
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
