"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateLeadStatusAction,
  convertLeadAction,
  type LeadActionState,
} from "../actions";
import type { LeadStatus } from "@prisma/client";

const NEXT_STATUSES: { value: "NEW" | "CONTACTED" | "LOST"; label: string }[] = [
  { value: "NEW", label: "Mark as New" },
  { value: "CONTACTED", label: "Mark as Contacted" },
  { value: "LOST", label: "Mark as Lost" },
];

export function LeadActionsPanel({
  leadId,
  status,
  hasEmail,
}: {
  leadId: string;
  status: LeadStatus;
  hasEmail: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    | { kind: "error"; text: string }
    | { kind: "converted"; customerId: string; tempPassword: string | null }
    | null
  >(null);

  function handleResult(result: LeadActionState) {
    if (result.status === "error") {
      setMessage({ kind: "error", text: result.message });
    } else if (result.status === "converted") {
      setMessage({
        kind: "converted",
        customerId: result.customerId,
        tempPassword: result.tempPassword,
      });
    } else {
      setMessage(null);
    }
    router.refresh();
  }

  if (status === "CONVERTED") {
    return (
      <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        This lead has already been converted to a customer.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {NEXT_STATUSES.filter((s) => s.value !== status).map((s) => (
          <button
            key={s.value}
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await updateLeadStatusAction(leadId, s.value);
                handleResult(result);
              })
            }
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400 disabled:opacity-50"
          >
            {s.label}
          </button>
        ))}

        <button
          type="button"
          disabled={isPending || !hasEmail}
          title={
            hasEmail
              ? undefined
              : "Add an email address for this lead first — a customer account needs one to sign in."
          }
          onClick={() =>
            startTransition(async () => {
              const result = await convertLeadAction(leadId);
              handleResult(result);
            })
          }
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Convert to customer
        </button>
      </div>

      {!hasEmail && (
        <p className="text-sm text-amber-700">
          This lead has no email address, so it can&apos;t be converted yet —
          a customer account needs one to sign in.
        </p>
      )}

      {message?.kind === "error" && (
        <p role="alert" className="text-sm text-red-700">
          {message.text}
        </p>
      )}

      {message?.kind === "converted" && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-medium">Converted to a customer.</p>
          {message.tempPassword ? (
            <>
              <p className="mt-2">
                A new account was created with a one-time temporary
                password — copy it now, it won&apos;t be shown again:
              </p>
              <code className="mt-1 block break-all rounded bg-white px-2 py-1 font-mono text-green-950">
                {message.tempPassword}
              </code>
              <p className="mt-2 text-green-800">
                There&apos;s no self-serve &ldquo;reset your password&rdquo;
                flow yet, so you&apos;ll need to relay this to the customer
                directly if you want them signed in before that&apos;s built.
              </p>
            </>
          ) : (
            <p className="mt-1">
              An existing account with this email was reused — no new
              password to relay.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
