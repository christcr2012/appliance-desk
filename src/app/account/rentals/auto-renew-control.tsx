"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
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
      <Button
        type="button"
        variant="secondary"
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
      >
        {pending
          ? "Saving…"
          : props.enabled
            ? "Turn off automatic renewal"
            : "Turn on automatic renewal"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
