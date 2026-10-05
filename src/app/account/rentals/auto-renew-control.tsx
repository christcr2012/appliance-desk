"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCustomerAutoRenewAction } from "./actions";

export function AutoRenewControl(props: {
  agreementId: string;
  enabled: boolean;
  termsVersion: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const nextEnabled = !props.enabled;

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const prompt = nextEnabled
            ? "Turn on automatic renewal using the terms shown above?"
            : "Turn off automatic renewal? Your rental will end on its existing end date unless you arrange something else.";
          if (!window.confirm(prompt)) return;
          setError(null);
          startTransition(async () => {
            const result = await setCustomerAutoRenewAction({
              agreementId: props.agreementId,
              enabled: nextEnabled,
              termsVersion: props.termsVersion,
            });
            if (result.status === "error") setError(result.message);
            else router.refresh();
          });
        }}
        className="min-h-11 rounded-lg border border-control px-4 py-2 text-sm text-primary hover:bg-subtle disabled:opacity-60"
      >
        {pending
          ? "Saving…"
          : props.enabled
            ? "Turn off automatic renewal"
            : "Turn on automatic renewal"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
