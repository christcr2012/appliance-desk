"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { markResaleTaxFollowUpDoneAction } from "../actions";

export function FollowUpButton({ dispositionId, invoiceId }: { dispositionId: string; invoiceId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await markResaleTaxFollowUpDoneAction(dispositionId, invoiceId);
            if (r.status === "error") return setError(r.message);
            router.refresh();
          })
        }
      >
        I talked to my accountant about this sale
      </Button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
