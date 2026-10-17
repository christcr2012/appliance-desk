"use client";

import { useCustomerTranslation, useCustomerLanguage } from "@/domains/language/client-portal";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMaintenanceRequestAction } from "./actions";
import { PhotoUploadField } from "@/components/photo-upload-field";
import { Button, Select, Textarea } from "@/components/ui";

type ApplianceOption = { id: string; label: string };

const PRIORITIES = [
  { value: "LOW", label: "Low — whenever's convenient" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High — affecting daily use" },
  { value: "URGENT", label: "Urgent — safety issue or completely unusable" },
] as const;

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
  const tr = useCustomerTranslation();
  const language = useCustomerLanguage();
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
        tr("Please describe your request, including pickup details if applicable."),
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
          kind: requestKind,
        });
      } catch {
        setError(
          tr("Your request was not confirmed. Your text and photos are still here; please try again."),
        );
        return;
      }

      if (result.status === "error") {
        setError(language === "es" ? tr("Your request could not be completed. Try again or contact the business.") : result.message);
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
          label={tr("Which appliance? (optional)")}
          value={applianceId}
          onChange={(event) => setApplianceId(event.target.value)}
        >
          <option value="">{tr("Not sure / general question")}</option>
          {appliances.map((appliance) => (
            <option key={appliance.id} value={appliance.id}>
              {appliance.label}
            </option>
          ))}
        </Select>
      )}

      <Textarea
        id="problem"
        label={tr("What's going on?")}
        rows={4}
        required
        value={problem}
        onChange={(event) => setProblem(event.target.value)}
      />

      <Select
        id="priority"
        label={tr("How urgent is this?")}
        value={priority}
        onChange={(event) => setPriority(event.target.value)}
      >
        {PRIORITIES.map((item) => (
          <option key={item.value} value={item.value}>
            {tr(item.label)}
          </option>
        ))}
      </Select>

      <div>
        <p className="text-sm font-semibold text-ink">{tr("Photo (optional)")}</p>
        <p className="mt-1 text-xs text-ink-soft">{tr("A picture of the problem — a leak, a broken part, anything that helps.")}</p>

        {photoUrls.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-semibold text-success">
              {photoUrls.length} {tr("Photos uploaded securely.")}
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
                  aria-label={`${tr("Remove uploaded photo")} ${index + 1}`}
                >
                  {tr("Remove photo")} {index + 1}
                </Button>
              ))}
            </div>
          </div>
        )}

        {photoUrls.length < MAX_PHOTOS && (
          <div className="mt-3">
            <PhotoUploadField
              pathPrefix={`maintenance-requests/${customerId}`}
              label={tr("Add a photo")}
              onUploaded={(url) => {
                setPhotoError(null);
                setPhotoUrls((urls) => [...urls, url]);
              }}
              onError={(message) => setPhotoError(language === "es" ? tr("Could not upload that photo. Try again.") : message)}
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
        {isPending ? tr("Submitting…") : tr("Submit request")}
      </Button>

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      {success && !error && (
        <p role="status" className="text-sm font-semibold text-success">
          {requestKind === "pickup"
            ? tr("Got it — we'll call you within one business day to schedule your pickup.")
            : tr("We received your problem report. We will review it and contact you to arrange a repair visit. Nothing is charged for reporting a problem.")}
        </p>
      )}
    </form>
  );
}
