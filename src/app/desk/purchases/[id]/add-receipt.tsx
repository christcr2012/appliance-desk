"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PhotoUploadField } from "@/components/photo-upload-field";
import { addPurchaseDocumentsAction, removePurchaseDocumentAction } from "../actions";

export function AddReceipt({ purchaseId }: { purchaseId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <PhotoUploadField
        pathPrefix={`purchases/${purchaseId}`} accept="image/*,application/pdf" label="Add receipt page"
        disabled={pending} onError={setError}
        onUploaded={(url) => start(async () => {
          setError(null);
          const result = await addPurchaseDocumentsAction({ purchaseId, documents: [{ url }] });
          if (result.status === "error") setError(result.message); else router.refresh();
        })}
      />
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}

export function RemoveReceiptPage({ purchaseId, documentId }: { purchaseId: string; documentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button type="button" className="ml-3 text-sm underline" disabled={pending} onClick={() => start(async () => {
        setError(null);
        const result = await removePurchaseDocumentAction(purchaseId, documentId);
        if (result.status === "error") setError(result.message); else router.refresh();
      })}>Remove</button>
      {error && <span role="alert" className="ml-2 text-sm font-semibold text-danger">{error}</span>}
    </span>
  );
}
