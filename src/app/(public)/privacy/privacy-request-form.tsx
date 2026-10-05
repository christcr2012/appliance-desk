import { publicPrivacyRequestAction } from "./actions";

export function PrivacyRequestForm({ received = false }: { received?: boolean }) {
  return (
    <section aria-labelledby="privacy-request-heading" className="rounded-2xl border border-line bg-surface p-6">
      <h2 id="privacy-request-heading" className="font-display text-xl font-semibold text-ink">
        Make a privacy request
      </h2>
      <p className="mt-2 text-sm text-ink-soft">
        Ask for a copy of the personal information connected to your customer account, or ask us to delete personal
        information we are allowed to remove. We keep records that must remain for billing, tax, signed agreements and
        audit purposes.
      </p>
      {received && (
        <p role="status" className="mt-4 rounded-lg border border-line bg-subtle p-3 text-sm text-ink">
          If the email matches information we hold, verification instructions will be sent when customer email is enabled.
          Otherwise, the owner will review the request. For privacy, this message is the same for every email address.
        </p>
      )}
      <form action={publicPrivacyRequestAction} className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="text-sm font-medium text-ink">
          Email address
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="mt-1 min-h-11 w-full rounded-lg border border-control bg-surface px-3 py-2 text-ink"
          />
        </label>
        <button
          type="submit"
          name="kind"
          value="EXPORT"
          className="min-h-11 rounded-lg border border-control px-4 py-2 text-sm font-medium text-primary hover:bg-subtle"
        >
          Request my data
        </button>
        <button
          type="submit"
          name="kind"
          value="DELETE"
          className="min-h-11 rounded-lg border border-control px-4 py-2 text-sm font-medium text-primary hover:bg-subtle"
        >
          Request deletion
        </button>
      </form>
    </section>
  );
}
