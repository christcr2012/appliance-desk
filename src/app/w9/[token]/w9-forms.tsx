"use client";

import { useActionState } from "react";
import { submitTypedAction, submitUploadAction, type W9SubmitState } from "./actions";

/** CMP-3: the two ways to answer the W-9 request — type it, or upload the signed PDF. */
export function W9Forms({ token }: { token: string }) {
  const [typedState, typedDispatch, typedPending] = useActionState<W9SubmitState, FormData>(
    (prev, formData) => submitTypedAction(token, prev, formData),
    {},
  );
  const [uploadState, uploadDispatch, uploadPending] = useActionState<W9SubmitState, FormData>(
    (prev, formData) => submitUploadAction(token, prev, formData),
    {},
  );
  const done = typedState.done || uploadState.done;
  if (done) {
    return (
      <div className="rounded-card bg-surface p-5">
        <h2 className="text-lg font-semibold text-ink">Thank you — your W-9 is on file.</h2>
        <p className="mt-2 text-sm text-ink-soft">
          This link has done its job and no longer works. If anything changes, we&apos;ll send a fresh link.
        </p>
      </div>
    );
  }
  const inputCls = "mt-1 w-full rounded border border-border px-3 py-2";
  return (
    <div className="space-y-8">
      <form action={typedDispatch} className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Type your W-9 answers</h2>
        <label className="block text-sm">
          Legal name (exactly as on your tax return)
          <input name="legalName" required autoComplete="name" className={inputCls} />
        </label>
        <label className="block text-sm">
          Tax ID type
          <select name="tinType" className={inputCls} defaultValue="EIN">
            <option value="EIN">EIN — a business</option>
            <option value="SSN">SSN — a person / sole proprietor</option>
          </select>
        </label>
        <label className="block text-sm">
          Tax ID number (9 digits)
          <input name="tin" required inputMode="numeric" autoComplete="off" className={inputCls} />
        </label>
        <p className="text-sm text-ink-soft">
          Your tax ID is encrypted as soon as it arrives. Only the last 4 digits are ever shown back.
        </p>
        {typedState.error ? <p className="text-sm text-red-700">{typedState.error}</p> : null}
        <button type="submit" disabled={typedPending} className="rounded bg-ink px-4 py-2 text-white disabled:opacity-50">
          Send my W-9 answers
        </button>
      </form>

      <div className="border-t border-border pt-6">
        <form action={uploadDispatch} className="space-y-3">
          <h2 className="text-lg font-semibold text-ink">Or upload a completed W-9</h2>
          <label className="block text-sm">
            Legal name (as on the form)
            <input name="legalName" required className={inputCls} />
          </label>
          <label className="block text-sm">
            The signed W-9 (PDF, up to 4 MB)
            <input name="w9file" type="file" accept="application/pdf" required className={inputCls} />
          </label>
          {uploadState.error ? <p className="text-sm text-red-700">{uploadState.error}</p> : null}
          <button type="submit" disabled={uploadPending} className="rounded bg-ink px-4 py-2 text-white disabled:opacity-50">
            Upload my W-9
          </button>
        </form>
      </div>
    </div>
  );
}
