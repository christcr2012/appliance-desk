"use client";

import { useActionState } from "react";
import { saveSpanishReviewAction, type SpanishReviewActionState } from "./spanish-review-actions";

type Props = {
  digest: string;
  currentReview: boolean;
  reviewedAt: string | null;
  legalReviewedAt: string | null;
  publishedAt: string | null;
  reviewerName: string | null;
  surfacesReady: boolean;
};

export function SpanishReviewForm({ digest, currentReview, reviewedAt,
  legalReviewedAt, publishedAt, reviewerName, surfacesReady }: Props) {
  const [state, action, pending] = useActionState<SpanishReviewActionState, FormData>(
    saveSpanishReviewAction, { status: "idle", message: "" },
  );
  return (
    <form action={action} className="space-y-3 text-sm">
      <input type="hidden" name="expectedDigest" value={digest} />
      <p>English remains the default. Spanish customer-facing documents, messages
        and signature screens stay disabled until a real fluent review AND a separate
        legal review of English-controlling agreement wording are documented.</p>
      <p className="break-all text-xs text-ink-soft">
        Copy fingerprint: <code>{digest}</code>
      </p>
      <p>Engineering surface coverage: {surfacesReady ? "All original routes implemented" : "Incomplete — public activation is blocked"}. Fluent reviewer: {reviewerName ?? "Not recorded"}.
        Status: {currentReview && reviewedAt ? "Current review recorded" : "Review pending or copy changed"}.
        Legal review: {legalReviewedAt ? "Recorded" : "Pending"}.
        Public Spanish: {publishedAt && currentReview && legalReviewedAt ? "Enabled" : "Disabled"}.</p>
      <label className="block">
        Reviewer identity (only after actual independent review)
        <input name="reviewer" maxLength={500} className="mt-1 w-full rounded border border-line bg-surface p-2"
          placeholder="Actual reviewer name and role" />
      </label>
      <label className="block">
        Evidence reference (no passwords, private identifiers or document contents)
        <input name="reference" maxLength={500} className="mt-1 w-full rounded border border-line bg-surface p-2"
          placeholder="Date and securely retained review record" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button name="action" value="FLUENT" type="submit" disabled={pending}
          className="rounded border border-line px-3 py-2">Record fluent review</button>
        <button name="action" value="LEGAL" type="submit" disabled={pending || !currentReview}
          className="rounded border border-line px-3 py-2">Record legal review</button>
        <button name="action" value="PUBLISH" type="submit" disabled={pending || !surfacesReady || !currentReview || !legalReviewedAt}
          className="rounded border border-line px-3 py-2">Enable reviewed Spanish</button>
        <button name="action" value="DISABLE" type="submit" disabled={pending || !publishedAt}
          className="rounded border border-line px-3 py-2">Disable Spanish</button>
      </div>
      <p role="status" aria-live="polite">{state.message}</p>
      <p className="text-xs text-ink-soft">Recording review does not buy translation services,
        send messages, replace signed history or activate Stripe LIVE.</p>
    </form>
  );
}
