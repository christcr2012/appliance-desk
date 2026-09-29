"use client";

import { useState } from "react";
import { SupplierForm } from "../supplier-form";

/** Shows the supplier's info as plain text, with an "Edit" toggle into
 * the same shared form used to create one — same collapse/expand
 * pattern this app already uses for other edit-in-place panels. */
export function SupplierDetailClient({
  supplierId,
  initial,
}: {
  supplierId: string;
  initial: { name: string; contactName: string; phone: string; email: string; notes: string };
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="mt-4">
        <SupplierForm supplierId={supplierId} initial={initial} onSaved={() => setEditing(false)} />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-2 text-sm text-gray-600 hover:underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{initial.name}</h1>
          {initial.contactName && <p className="text-sm text-gray-700">{initial.contactName}</p>}
          {initial.phone && <p className="text-sm text-gray-600">{initial.phone}</p>}
          {initial.email && <p className="text-sm text-gray-600">{initial.email}</p>}
          {initial.notes && <p className="mt-2 text-sm text-gray-600">{initial.notes}</p>}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400"
        >
          Edit
        </button>
      </div>
    </div>
  );
}
