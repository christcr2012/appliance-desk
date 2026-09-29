"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupplierAction, updateSupplierAction } from "../purchasing-actions";

type SupplierFormValues = {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  notes: string;
};

/** Shared by "add a supplier" (no supplierId) and editing an existing
 * one (supplierId set) — same fields either way, same pattern as this
 * app's other create/edit form pairs (e.g. the customer address form). */
export function SupplierForm({
  supplierId,
  initial,
  onSaved,
}: {
  supplierId?: string;
  initial?: Partial<SupplierFormValues>;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<SupplierFormValues>({
    name: initial?.name ?? "",
    contactName: initial?.contactName ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    notes: initial?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = supplierId
        ? await updateSupplierAction(supplierId, values)
        : await createSupplierAction(values);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      if (onSaved) {
        onSaved();
      } else if (result.status === "success" && result.id) {
        router.push(`/desk/suppliers/${result.id}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div>
        <label htmlFor="supplier-name" className="block text-sm font-medium text-gray-700">
          Supplier name
        </label>
        <input
          id="supplier-name"
          type="text"
          required
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="supplier-contact-name" className="block text-sm font-medium text-gray-700">
          Contact name
        </label>
        <input
          id="supplier-contact-name"
          type="text"
          value={values.contactName}
          onChange={(e) => setValues({ ...values, contactName: e.target.value })}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="supplier-phone" className="block text-sm font-medium text-gray-700">
            Phone
          </label>
          <input
            id="supplier-phone"
            type="tel"
            value={values.phone}
            onChange={(e) => setValues({ ...values, phone: e.target.value })}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="supplier-email" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="supplier-email"
            type="email"
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <label htmlFor="supplier-notes" className="block text-sm font-medium text-gray-700">
          Notes
        </label>
        <textarea
          id="supplier-notes"
          rows={3}
          value={values.notes}
          onChange={(e) => setValues({ ...values, notes: e.target.value })}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Saving…" : supplierId ? "Save changes" : "Add supplier"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
