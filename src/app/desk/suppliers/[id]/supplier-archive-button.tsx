"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { setSupplierArchivedAction } from "../../purchasing-actions";

export function SupplierArchiveButton({
  supplierId,
  archived,
}: {
  supplierId: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card
      title={archived ? "Archived supplier" : "Archive supplier"}
      description={
        archived
          ? "This supplier is hidden from the order form and cannot take new orders. Its past orders are kept."
          : "Archive this supplier to hide it from the order form while keeping its past orders. You can restore it later."
      }
    >
      <Button
        type="button"
        variant={archived ? "secondary" : "danger"}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await setSupplierArchivedAction(
              supplierId,
              !archived,
            );
            if (result.status === "error") {
              setError(result.message);
              return;
            }
            router.refresh();
          })
        }
      >
        {archived ? "Restore this supplier" : "Archive this supplier"}
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
