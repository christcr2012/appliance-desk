"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  updateApplianceStatusAction,
  updateApplianceDetailsAction,
  addAppliancePhotoAction,
} from "../actions";
import { PhotoUploadField } from "@/components/photo-upload-field";
import type { ApplianceStatus } from "@prisma/client";
import {
  ALL_APPLIANCE_STATUSES,
  ALLOWED_APPLIANCE_TRANSITIONS,
  APPLIANCE_STATUS_LABELS,
} from "@/domains/inventory/lifecycle";

const ALL_STATUSES: { value: ApplianceStatus; label: string }[] = ALL_APPLIANCE_STATUSES.map(
  (value) => ({ value, label: APPLIANCE_STATUS_LABELS[value] }),
);

const ALLOWED_NEXT = ALLOWED_APPLIANCE_TRANSITIONS;

type ApplianceRow = {
  id: string;
  status: ApplianceStatus;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  color: string | null;
  features: unknown;
  condition: string | null;
  currentLocation: string | null;
  notes: string | null;
  updatedAt: Date;
  photos: { id: string; url: string; altText: string | null }[];
};

function featuresToText(features: unknown): string {
  if (!Array.isArray(features)) return "";
  return features.filter((f): f is string => typeof f === "string").join(", ");
}

function revokePreview(url: string): void {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function ApplianceDetailPanel({ appliance }: { appliance: ApplianceRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [fields, setFields] = useState({
    manufacturer: appliance.manufacturer ?? "",
    model: appliance.model ?? "",
    serialNumber: appliance.serialNumber ?? "",
    color: appliance.color ?? "",
    features: featuresToText(appliance.features),
    condition: appliance.condition ?? "",
    currentLocation: appliance.currentLocation ?? "",
    notes: appliance.notes ?? "",
  });
  const [saveMessage, setSaveMessage] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
  const [photoAlt, setPhotoAlt] = useState("");
  const [photoError, setPhotoError] = useState<string | null>(null);

  const nextStatuses = ALLOWED_NEXT[appliance.status];

  function update<K extends keyof typeof fields>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function handleStatusChange(status: ApplianceStatus) {
    setStatusMessage(null);
    startTransition(async () => {
      const result = await updateApplianceStatusAction(appliance.id, status);
      if (result.status === "error") {
        setStatusMessage(result.message);
      }
      router.refresh();
    });
  }

  function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    setSaveMessage(null);
    startTransition(async () => {
      const result = await updateApplianceDetailsAction(appliance.id, {
        ...fields,
        expectedUpdatedAt: appliance.updatedAt.toISOString(),
      });
      if (result.status === "error") {
        setSaveMessage({ kind: "error", text: result.message });
      } else {
        setSaveMessage({ kind: "success", text: "Saved." });
        router.refresh();
      }
    });
  }

  function handleAddPhoto(e: React.FormEvent) {
    e.preventDefault();
    setPhotoError(null);
    startTransition(async () => {
      const result = await addAppliancePhotoAction(appliance.id, {
        url: photoUrl,
        altText: photoAlt,
      });
      if (result.status === "error") {
        setPhotoError(result.message);
      } else {
        revokePreview(photoPreviewUrl);
        setPhotoUrl("");
        setPhotoPreviewUrl("");
        setPhotoAlt("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-line bg-white p-5">
        <h2 className="font-medium text-ink">
          Status: {APPLIANCE_STATUS_LABELS[appliance.status]}
        </h2>
        {nextStatuses.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">
            Retired appliances can&apos;t change status — add a new unit instead if
            this was retired by mistake.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {ALL_STATUSES.filter((s) => nextStatuses.includes(s.value)).map((s) => (
              <button
                key={s.value}
                type="button"
                disabled={isPending}
                onClick={() => handleStatusChange(s.value)}
                className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-ink-soft hover:border-line-strong disabled:opacity-50"
              >
                Mark {s.label}
              </button>
            ))}
          </div>
        )}
        {statusMessage && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {statusMessage}
          </p>
        )}
      </div>

      <form
        onSubmit={handleSaveDetails}
        className="space-y-4 rounded-lg border border-line bg-white p-5"
      >
        <h2 className="font-medium text-ink">Details</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="manufacturer" className="block text-sm font-medium text-ink-soft">
              Manufacturer
            </label>
            <input
              id="manufacturer"
              type="text"
              value={fields.manufacturer}
              onChange={(e) => update("manufacturer", e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="model" className="block text-sm font-medium text-ink-soft">
              Model
            </label>
            <input
              id="model"
              type="text"
              value={fields.model}
              onChange={(e) => update("model", e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="serialNumber" className="block text-sm font-medium text-ink-soft">
              Serial number
            </label>
            <input
              id="serialNumber"
              type="text"
              value={fields.serialNumber}
              onChange={(e) => update("serialNumber", e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="condition" className="block text-sm font-medium text-ink-soft">
              Condition
            </label>
            <input
              id="condition"
              type="text"
              value={fields.condition}
              onChange={(e) => update("condition", e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="color" className="block text-sm font-medium text-ink-soft">
              Color
            </label>
            <input
              id="color"
              type="text"
              placeholder="e.g. White, Stainless"
              value={fields.color}
              onChange={(e) => update("color", e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="features" className="block text-sm font-medium text-ink-soft">
              Features
            </label>
            <input
              id="features"
              type="text"
              placeholder="e.g. front-load, agitator"
              value={fields.features}
              onChange={(e) => update("features", e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-ink-faint">Separate multiple with commas.</p>
          </div>
        </div>

        <div>
          <label htmlFor="currentLocation" className="block text-sm font-medium text-ink-soft">
            Current location
          </label>
          <input
            id="currentLocation"
            type="text"
            value={fields.currentLocation}
            onChange={(e) => update("currentLocation", e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-ink-soft">
            Notes
          </label>
          <textarea
            id="notes"
            rows={3}
            value={fields.notes}
            onChange={(e) => update("notes", e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save details"}
        </button>

        {saveMessage?.kind === "error" && (
          <p role="alert" className="text-sm text-red-700">
            {saveMessage.text}
          </p>
        )}
        {saveMessage?.kind === "success" && (
          <p className="text-sm text-green-700">{saveMessage.text}</p>
        )}
      </form>

      <div className="space-y-4 rounded-lg border border-line bg-white p-5">
        <h2 className="font-medium text-ink">Photos of this unit</h2>

        {appliance.photos.length === 0 ? (
          <p className="text-sm text-ink-soft">No photos added yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {appliance.photos.map((p) => (
              <div key={p.id} className="relative h-32 w-full overflow-hidden rounded-lg">
                <Image
                  src={p.url}
                  alt={p.altText ?? "Photo of this appliance"}
                  fill
                  sizes="(min-width: 640px) 33vw, 45vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAddPhoto} className="space-y-3 border-t border-line pt-4">
          <div>
            <span className="block text-sm font-medium text-ink-soft">Photo</span>
            <div className="mt-1 flex items-center gap-3">
              {photoPreviewUrl && (
                <Image
                  src={photoPreviewUrl}
                  alt="Selected photo, not yet added"
                  width={64}
                  height={64}
                  unoptimized
                  className="h-16 w-16 rounded-md object-cover"
                />
              )}
              <PhotoUploadField
                pathPrefix={`appliances/${appliance.id}`}
                label={photoUrl ? "Replace photo" : "Take or choose a photo"}
                onUploaded={(storageUrl, previewUrl) => {
                  setPhotoError(null);
                  revokePreview(photoPreviewUrl);
                  setPhotoUrl(storageUrl);
                  setPhotoPreviewUrl(previewUrl);
                }}
                onError={(message) => setPhotoError(message)}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="appliancePhotoAlt"
              className="block text-sm font-medium text-ink-soft"
            >
              Description (optional)
            </label>
            <input
              id="appliancePhotoAlt"
              type="text"
              placeholder="e.g. Serial plate, dent on side panel"
              value={photoAlt}
              onChange={(e) => setPhotoAlt(e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={isPending || !photoUrl}
            className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
          >
            {isPending ? "Adding…" : "Add photo"}
          </button>
          {photoError && (
            <p role="alert" className="text-sm text-red-700">
              {photoError}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
