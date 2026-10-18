"use client";
import { useState } from "react";
import { PhotoUploadField } from "@/components/photo-upload-field";
import { attachExpenseReceiptAction } from "./actions";

export function ExpenseReceiptUpload({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState("");
  return <form action={attachExpenseReceiptAction} className="space-y-2">
    <input type="hidden" name="id" value={id}/>
    <input type="hidden" name="url" value={url}/>
    <PhotoUploadField pathPrefix={`expenses/${id}`} access="private"
      label="Upload a private receipt" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
      onUploaded={storageUrl => {setUrl(storageUrl);setProblem("");}}
      onError={setProblem}/>
    {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
    {url && <button type="submit" className="rounded border border-border bg-card px-3 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2">Attach receipt to expense</button>}
  </form>;
}
