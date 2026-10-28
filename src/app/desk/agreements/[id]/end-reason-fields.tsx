/**
 * AR-4a (RENTALS spec section 5): the one optional "Why is it ending?"
 * question shown at the confirm step of every path that ends a rental.
 * Renders plain form fields named endReason / endReasonNote; each ending
 * action parses and stores them (see domains/agreements/end-reasons.ts —
 * the note cap and the "Other" value there must match these literals).
 * Never required, never customer-facing.
 */
export function EndReasonFields({ reasons }: { reasons: string[] }) {
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-medium text-ink">
        Why is it ending? <span className="font-normal text-ink-soft">(optional)</span>
      </legend>
      <select
        name="endReason"
        defaultValue=""
        className="mt-1 min-h-11 w-full rounded-lg border border-control bg-surface px-3"
        aria-label="Why is it ending?"
      >
        <option value="">No answer</option>
        {reasons.map((reason) => (
          <option key={reason} value={reason}>
            {reason}
          </option>
        ))}
        <option value="Other">Other</option>
      </select>
      <input
        name="endReasonNote"
        maxLength={200}
        placeholder="Anything else worth remembering (optional)"
        className="mt-2 min-h-11 w-full rounded-lg border border-control px-3"
        aria-label="End reason note"
      />
      <p className="mt-1 text-xs text-ink-soft">
        For your records only — the customer never sees this. It helps you see why customers leave.
      </p>
    </fieldset>
  );
}
