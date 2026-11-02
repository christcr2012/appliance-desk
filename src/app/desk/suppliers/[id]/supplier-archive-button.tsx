"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/kit";
import { setSupplierArchivedAction } from "../../purchasing-actions";

/**
 * AR-6b section 7: archiving a supplier asks first, from the record's
 * header overflow ("Archive {name}? You can restore it later."). The
 * caller mounts this only while the confirmation should be open (the
 * ?archive=1 state); closing returns to the plain record URL. Restoring
 * needs no confirmation — it is a plain link in the same overflow menu.
 */
export function SupplierArchiveButton({
  supplierId,
  name,
}: {
  supplierId: string;
  name: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    router.replace(`/desk/suppliers/${supplierId}`);
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await setSupplierArchivedAction(supplierId, true);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      router.refresh();
      close();
    });
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      spec={{
        title: `Archive ${name}?`,
        summary: "You can restore it later. Its past orders and purchases are kept.",
        confirmLabel: "Archive it",
        danger: true,
      }}
      onConfirm={confirm}
      details={
        error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : undefined
      }
    />
  );
}
