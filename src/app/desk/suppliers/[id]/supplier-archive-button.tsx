"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSupplierArchivedAction } from "../../purchasing-actions";

/** Archive hides a supplier from pickers and blocks new orders; its history is kept. Restore brings it back. */
export function SupplierArchiveButton({ supplierId, archived }: { supplierId: string; archived: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-6 rounded-lg border border-line bg-white p-4 text-sm">
      <p className="text-ink-soft">
        {archived
          ? "This supplier is archived: it is hidden from the order form and cannot take new orders. Its past orders are kept."
          : "No longer ordering from this supplier? Archive it to hide it from the order form. Its past orders are kept, and you can restore it any time."}
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await setSupplierArchivedAction(supplierId, !archived);
            if (result.status === "error") setError(result.message);
            else router.refresh();
          })
        }
        className="mt-2 rounded-md border border-line-strong px-3 py-1.5 text-ink disabled:opacity-60"
      >
        {archived ? "Restore this supplier" : "Archive this supplier"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
