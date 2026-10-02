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
  /** Called once the file has finished uploading, with its storage URL. */
  onUploaded: (url: string) => void;
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
      onUploaded(result.url);
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
        className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 ${
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
