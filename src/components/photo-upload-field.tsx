"use client";

import { useId, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

type Props = {
  /**
   * A folder-like prefix for where this photo lands in Blob storage (e.g.
   * "appliance-types" or `jobs/${jobId}`) — just for organizing the store,
   * doesn't need to be unique on its own since Blob adds a random suffix.
   */
  pathPrefix: string;
  /**
   * Operational/customer evidence is private by default. Public must be an
   * explicit caller decision and is reserved for catalog/marketing imagery.
   */
  access?: "private" | "public";
  /**
   * Called after upload with both the durable provider URL to persist and a
   * browser-readable preview URL. Private Blob URLs cannot be fetched by the
   * browser directly, so private uploads get a temporary object URL backed by
   * the file the user just selected. Callers that keep that preview should
   * revoke it when replacing/removing it or after the durable record is saved.
   */
  onUploaded: (storageUrl: string, previewUrl: string) => void;
  onError?: (message: string) => void;
  label?: string;
  disabled?: boolean;
};

export function PhotoUploadField({
  pathPrefix,
  access = "private",
  onUploaded,
  onError,
  label = "Add a photo",
  disabled,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    if (!file) return;

    setIsUploading(true);
    try {
      const result = await upload(`${pathPrefix}/${file.name}`, file, {
        access,
        handleUploadUrl: "/api/uploads/photo",
      });
      const previewUrl = access === "private" ? URL.createObjectURL(file) : result.url;
      onUploaded(result.url, previewUrl);
    } catch (error) {
      onError?.(
        error instanceof Error
          ? error.message
          : "Could not upload that photo. Try again.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="inline-block">
      <label
        htmlFor={inputId}
        className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft hover:border-line-strong ${
          disabled || isUploading ? "pointer-events-none opacity-60" : ""
        }`}
      >
        {isUploading ? "Uploading…" : label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        disabled={disabled || isUploading}
        onChange={handleFileChange}
        className="sr-only"
      />
    </div>
  );
}
