"use client";
import { useState } from "react";
import { PhotoUploadField } from "@/components/photo-upload-field";

/** The upload is private and provisional until the filing command claims it. */
export function FilingEvidenceUpload({ periodId }: { periodId: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  return <div className="space-y-2 rounded-lg border border-border p-3">
    <p className="text-sm font-semibold">Optional private filing confirmation image</p>
    <PhotoUploadField pathPrefix={`tax-filings/${periodId}`} access="private"
      label={url ? "Replace private evidence" : "Upload private evidence"}
      onUploaded={(storageUrl, previewUrl) => {
        URL.revokeObjectURL(previewUrl);
        setUrl(storageUrl);
        setError("");
      }}
      onError={setError} />
    <input type="hidden" name="confirmationPhotoUrl" value={url} />
    {url && <p role="status" className="text-sm">Private upload ready to attach when the return is filed.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">Only the current return may claim this private upload. Uploading does not file or pay anything.</p>
  </div>;
}

