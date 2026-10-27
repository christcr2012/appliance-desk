"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { Button, Field } from "@/components/ui";
import {
  registerRecordFileAction,
  uploadRecordFileAction,
  type RecordActionState,
} from "./record-actions";

/**
 * VAULT-1 file upload for one record. Small files (≤ 900 KB — PDFs and photos
 * the browser has already shrunk) go through the server action. A larger PDF
 * (up to 15 MB) is uploaded straight to the private store with a one-use
 * token bound to this record, then registered so the server can verify it.
 */
export function RecordFileUpload({ recordId }: { recordId: string }) {
  const [state, formAction, pending] = useActionState(
    uploadRecordFileAction.bind(null, recordId),
    { status: "idle" } as RecordActionState,
  );
  const router = useRouter();
  const largeInput = useRef<HTMLInputElement>(null);
  const [largeBusy, setLargeBusy] = useState(false);
  const [largeMessage, setLargeMessage] = useState<string | null>(null);

  async function uploadLarge() {
    const file = largeInput.current?.files?.[0];
    if (!file) {
      setLargeMessage("Choose a PDF first.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setLargeMessage("That PDF is larger than 15 MB. It can't be attached.");
      return;
    }
    setLargeBusy(true);
    setLargeMessage(null);
    try {
      const result = await upload(`records/${recordId}/${file.name}`, file, {
        access: "private",
        handleUploadUrl: "/api/uploads/photo",
      });
      const registered = await registerRecordFileAction(recordId, {
        pathname: result.pathname,
        fileName: file.name,
      });
      if (registered.status === "error") {
        setLargeMessage(registered.message);
      } else {
        router.refresh();
      }
    } catch (error) {
      setLargeMessage(error instanceof Error ? error.message : "That upload failed. Try again.");
    } finally {
      setLargeBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-3">
        <Field
          label="Add a file (PDF or photo, up to 900 KB)"
          name="file"
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          required
        />
        <Field label="What is this file? (optional)" name="label" placeholder="For example: Signed copy, page 1" />
        {state.status === "error" && (
          <p role="alert" className="text-sm font-semibold text-danger">{state.message}</p>
        )}
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add the file"}</Button>
      </form>
      <div className="border-t border-line pt-4">
        <label className="block text-sm font-semibold" htmlFor="large-pdf">
          Add a large PDF (up to 15 MB)
        </label>
        <p className="mt-1 text-xs text-ink-soft">
          Big scanned documents go straight to the private store. Only PDFs can be added this way.
        </p>
        <input
          id="large-pdf"
          ref={largeInput}
          type="file"
          accept="application/pdf"
          className="mt-2 block text-sm"
        />
        {largeMessage && (
          <p role="alert" className="mt-2 text-sm font-semibold text-danger">{largeMessage}</p>
        )}
        <div className="mt-3">
          <Button type="button" variant="secondary" disabled={largeBusy} onClick={uploadLarge}>
            {largeBusy ? "Uploading…" : "Upload the large PDF"}
          </Button>
        </div>
      </div>
    </div>
  );
}
