"use client";

import { useCustomerTranslation } from "@/domains/language/client-portal";
import { useId, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { preparePhotoForUpload } from "@/lib/photo-convert";

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
  /** File types the picker offers; the server still decides what each folder accepts. */
  accept?: string;
};

export function PhotoUploadField({
  pathPrefix,
  access = "private",
  onUploaded,
  onError,
  label = "Add a photo",
  disabled,
  accept = "image/*",
}: Props) {
  const tr = useCustomerTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    if (!chosen) return;

    setIsUploading(true);
    try {
      // HEIC/HEIF phone pictures become ordinary JPEGs first, so every stored picture can be shown in any browser.
      const prepared = await preparePhotoForUpload(chosen);
      if (!prepared.ok) {
        onError?.(prepared.message);
        return;
      }
      const file = prepared.file;
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
    // The real file input is visually hidden, so the keyboard focus ring is drawn around the whole control (the visible
    // label) whenever the hidden input has keyboard focus.
    <div className="inline-block rounded-md has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
      <label
        htmlFor={inputId}
        className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft hover:border-line-strong ${
          disabled || isUploading ? "pointer-events-none opacity-60" : ""
        }`}
      >
        {isUploading ? tr("Uploading…") : label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled || isUploading}
        onChange={handleFileChange}
        className="sr-only"
      />
    </div>
  );
}
