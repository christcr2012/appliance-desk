"use client";

import { useState, useTransition } from "react";
import { resendActivationEmailAction } from "../actions";

/** A small, self-contained action for a customer's own page — see
 * src/app/desk/customers/actions.ts for what it actually does and why. */
export function ResendActivationButton({ customerId }: { customerId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "sent" } | { kind: "error"; text: string } | null
  >(null);

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await resendActivationEmailAction(customerId);
            setMessage(
              result.status === "sent"
                ? { kind: "sent" }
                : { kind: "error", text: result.message },
            );
          })
        }
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400 disabled:opacity-50"
      >
        {isPending ? "Sending…" : "Resend activation email"}
      </button>
      {message?.kind === "sent" && (
        <p className="mt-2 text-sm text-green-700">
          Sent — the customer can use it to set their password and log in.
        </p>
      )}
      {message?.kind === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {message.text}
        </p>
      )}
    </div>
  );
}
