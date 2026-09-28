"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCustomerContactAction, deleteCustomerContactAction } from "../actions";

type Contact = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

/** Additional contacts for a customer beyond their own login — a site
 * manager, an accounts-payable contact for a business/property-manager
 * account. See the CustomerContact model's own comment. */
export function ContactsPanel({
  customerId,
  contacts,
}: {
  customerId: string;
  contacts: Contact[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await addCustomerContactAction(customerId, {
        name: String(data.get("name") ?? ""),
        role: String(data.get("role") ?? ""),
        phone: String(data.get("phone") ?? ""),
        email: String(data.get("email") ?? ""),
        notes: String(data.get("notes") ?? ""),
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setError(null);
      formRef.current?.reset();
      setShowForm(false);
      router.refresh();
    });
  }

  function handleDelete(contactId: string) {
    startTransition(async () => {
      await deleteCustomerContactAction(customerId, contactId);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-gray-900">Other contacts</h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="text-sm text-primary hover:underline"
        >
          {showForm ? "Cancel" : "+ Add contact"}
        </button>
      </div>

      {contacts.length === 0 && !showForm && (
        <p className="mt-2 text-sm text-gray-600">
          None on file — the customer&apos;s own login is the only contact.
        </p>
      )}

      {contacts.length > 0 && (
        <ul className="mt-3 space-y-3">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 text-sm">
              <div>
                <p className="font-medium text-gray-900">
                  {c.name}
                  {c.role ? ` — ${c.role}` : ""}
                </p>
                {(c.phone || c.email) && (
                  <p className="text-gray-600">
                    {[c.phone, c.email].filter(Boolean).join(" · ")}
                  </p>
                )}
                {c.notes && <p className="text-gray-500">{c.notes}</p>}
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleDelete(c.id)}
                className="shrink-0 text-xs text-gray-500 hover:text-red-700 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <form ref={formRef} onSubmit={handleAdd} className="mt-4 space-y-2">
          <input
            name="name"
            required
            placeholder="Name"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <input
            name="role"
            placeholder="Role (e.g. Site manager)"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <input
            name="phone"
            placeholder="Phone"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <input
            name="email"
            type="email"
            placeholder="Email"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <textarea
            name="notes"
            rows={2}
            placeholder="Notes (optional)"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save contact"}
          </button>
        </form>
      )}
    </div>
  );
}
