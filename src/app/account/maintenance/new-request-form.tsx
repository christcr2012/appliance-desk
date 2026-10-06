"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMaintenanceRequestAction } from "./actions";
import { PhotoUploadField } from "@/components/photo-upload-field";
import { Button, Select, Textarea } from "@/components/ui";

type ApplianceOption = { id: string; label: string };

const PRIORITIES: { value: string; label: string }[] = [
  { value: "LOW", label: "Low — whenever's convenient" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High — affecting daily use" },
  { value: "URGENT", label: "Urgent — safety issue or completely unusable" },
];

export function NewRequestForm({
  appliances,
  customerId,
  initialApplianceId = "",
  initialProblem = "",
  requestKind = "maintenance",
  requestTitle = "Report a problem",
}: {
  appliances: ApplianceOption[];
  customerId: string;
  initialApplianceId?: string;
  initialProblem?: string;
  requestKind?: "pickup" | "maintenance";
  requestTitle?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [problem, setProblem] = useState(initialProblem);
  const [applianceId, setApplianceId] = useState(initialApplianceId);
  const [priority, setPriority] = useState("NORMAL");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const MAX_PHOTOS = 6;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (!problem.replace(/^pickup request:\s*/i, "").trim()) {
      setError(
        "Please describe your request, including pickup details if applicable.",
      );
      return;
    }

    startTransition(async () => {
      let result;
      try {
        result = await createMaintenanceRequestAction({
          problem:
            requestKind === "pickup"
              ? `Pickup request: ${problem.trim()}`
              : problem,
          applianceId,
          priority,
          photoUrls,
        });
      } catch {
        setError(
          "Your request was not confirmed. Your text and photos are still here; please try again.",
        );
        return;
      }

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
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm font-semibold text-ink">{requestTitle}</p>

      {appliances.length > 0 && (
        <Select
          id="applianceId"
          label="Which appliance? (optional)"
          value={applianceId}
          onChange={(event) => setApplianceId(event.target.value)}
        >
          <option value="">Not sure / general question</option>
          {appliances.map((appliance) => (
            <option key={appliance.id} value={appliance.id}>
              {appliance.label}
            </option>
          ))}
        </Select>
      )}

      <Textarea
        id="problem"
        label="What's going on?"
        rows={4}
        required
        value={problem}
        onChange={(event) => setProblem(event.target.value)}
      />

      <Select
        id="priority"
        label="How urgent is this?"
        value={priority}
        onChange={(event) => setPriority(event.target.value)}
      >
        {PRIORITIES.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>

      <div>
        <p className="text-sm font-semibold text-ink">Photo (optional)</p>
        <p className="mt-1 text-xs text-ink-soft">
          A picture of the problem — a leak, a broken part, anything that helps.
        </p>

        {photoUrls.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-semibold text-success">
              {photoUrls.length} photo{photoUrls.length === 1 ? "" : "s"}{" "}
              uploaded securely.
            </p>
            <div className="flex flex-wrap gap-2">
              {photoUrls.map((url, index) => (
                <Button
                  key={url}
                  type="button"
                  variant="quiet"
                  onClick={() =>
                    setPhotoUrls((urls) =>
                      urls.filter((savedUrl) => savedUrl !== url),
                    )
                  }
                  aria-label={`Remove uploaded photo ${index + 1}`}
                >
                  Remove photo {index + 1}
                </Button>
              ))}
            </div>
          </div>
        )}

        {photoUrls.length < MAX_PHOTOS && (
          <div className="mt-3">
            <PhotoUploadField
              pathPrefix={`maintenance-requests/${customerId}`}
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
          <p role="alert" className="mt-2 text-xs font-semibold text-danger">
            {photoError}
          </p>
        )}
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Submitting…" : "Submit request"}
      </Button>

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      {success && !error && (
        <p role="status" className="text-sm font-semibold text-success">
          Got it — we&apos;ll be in touch about next steps.
        </p>
      )}
    </form>
  );
}
