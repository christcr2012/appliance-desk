"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLeadAction } from "../actions";

export function NewLeadForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [isBusiness, setIsBusiness] = useState(false);
  const [isPropertyManager, setIsPropertyManager] = useState(false);
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createLeadAction({
        contactName,
        phone,
        email,
        companyName,
        isBusiness,
        isPropertyManager,
        addressLine1,
        city,
        zip,
        notes,
      });

      if (result.status !== "success") {
        setError(result.status === "error" ? result.message : "Couldn't add that lead.");
        return;
      }

      router.push(`/desk/leads/${result.leadId}`);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-2xl space-y-6 rounded-lg border border-line bg-white p-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contactName" className="block text-sm font-medium text-ink-soft">
            Name
          </label>
          <input
            id="contactName"
            required
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-ink-soft">
            Phone
          </label>
          <input
            id="phone"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-ink-soft">
            Email (optional for now)
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ink-faint">
            Needed later if this converts to a customer — you can add it
            now or when that happens.
          </p>
        </div>
        <div>
          <label htmlFor="companyName" className="block text-sm font-medium text-ink-soft">
            Company name (if any)
          </label>
          <input
            id="companyName"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={isBusiness}
            onChange={(e) => setIsBusiness(e.target.checked)}
          />
          This is a business account
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={isPropertyManager}
            onChange={(e) => setIsPropertyManager(e.target.checked)}
          />
          They&apos;re a landlord, property manager, or apartment operator
          managing multiple properties
        </label>
      </div>

      <div>
        <h2 className="font-medium text-ink">Address (optional)</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Fill this in if you already know it — you can always add it later.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label htmlFor="addressLine1" className="block text-xs font-medium text-ink-soft">
              Street address
            </label>
            <input
              id="addressLine1"
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="city" className="block text-xs font-medium text-ink-soft">
              City
            </label>
            <input
              id="city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="zip" className="block text-xs font-medium text-ink-soft">
              ZIP
            </label>
            <input
              id="zip"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-ink-soft">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          placeholder="What they're looking for, how you heard from them, anything worth remembering."
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
      >
        {isPending ? "Adding…" : "Add lead"}
      </button>
    </form>
  );
}
