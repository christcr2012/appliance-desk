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
            // Belt-and-suspenders alongside the server action's own
            // try/catch (2026-09-29, Chris reported this button
            // "wasn't sending the email either" with no error showing)
            // — if the request itself fails (a network hiccup, the
            // server restarting mid-deploy), this still shows
            // something instead of the button just going quiet.
            try {
              const result = await resendActivationEmailAction(customerId);
              setMessage(
                result.status === "sent"
                  ? { kind: "sent" }
                  : { kind: "error", text: result.message },
              );
            } catch {
              setMessage({
                kind: "error",
                text: "Something went wrong sending that — try again in a moment.",
              });
            }
          })
        }
        className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-ink-soft hover:border-line-strong disabled:opacity-50"
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
