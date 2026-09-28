"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
    | {
        kind: "converted";
        customerId: string;
        isNewAccount: boolean;
        activationEmailSent: boolean;
      }
    | null
  >(null);

  function handleResult(result: LeadActionState) {
    if (result.status === "error") {
      setMessage({ kind: "error", text: result.message });
    } else if (result.status === "converted") {
      setMessage({
        kind: "converted",
        customerId: result.customerId,
        isNewAccount: result.isNewAccount,
        activationEmailSent: result.activationEmailSent,
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
          {message.isNewAccount ? (
            message.activationEmailSent ? (
              <p className="mt-2">
                A new account was created, and an email was sent so the
                customer can set their own password and log in. Nothing for
                you to relay — if they say it didn&apos;t arrive, use
                &ldquo;Resend activation email&rdquo; on their customer page.
              </p>
            ) : (
              <p className="mt-2 text-amber-800">
                A new account was created, but the activation email
                couldn&apos;t be sent just now. Use &ldquo;Resend activation
                email&rdquo; on their customer page to try again.
              </p>
            )
          ) : (
            <p className="mt-1">
              An existing account with this email was reused — nothing new
              to send them.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/desk/customers/${message.customerId}`}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
            >
              Go to their customer page
            </Link>
            <Link
              href={`/desk/agreements/new?customerId=${message.customerId}`}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400"
            >
              Start an agreement
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
