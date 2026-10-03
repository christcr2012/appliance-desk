"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { turnOffAutoRenewAction } from "./actions";

export function TurnOffAutoRenew({ agreementId }: { agreementId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Turn off automatic renewal? Your rental will end on its end date instead of continuing month to month.")) return;
          setError(null);
          startTransition(async () => {
            const result = await turnOffAutoRenewAction({ agreementId });
            if (result.status === "error") setError(result.message);
            else router.refresh();
          });
        }}
        className="min-h-11 rounded-lg border border-control px-4 py-2 text-sm text-primary hover:bg-subtle disabled:opacity-60"
      >
        {pending ? "Saving…" : "Turn off automatic renewal"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
