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

const NEXT_STATUSES: { value: "NEW" | "CONTACTED"; label: string }[] = [
  { value: "NEW", label: "Mark as New" },
  { value: "CONTACTED", label: "Mark as Contacted" },
];

// A short pick-list of common reasons a lead goes LOST (2026-09-29,
// Chris's CRM brainstorm — see docs/DECISIONS.md) — "Other" always lets
// staff type something not on the list; nothing here constrains what's
// actually stored (Lead.lostReason is free text).
const LOST_REASONS = [
  "Too expensive",
  "Went with a competitor",
  "Outside our service area",
  "Never heard back after contacting them",
  "Changed their mind / no longer needed",
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
  const [showLostForm, setShowLostForm] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostReasonOther, setLostReasonOther] = useState("");
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

        {status !== "LOST" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setShowLostForm((v) => !v)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400 disabled:opacity-50"
          >
            {showLostForm ? "Cancel" : "Mark as Lost"}
          </button>
        )}

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

      {showLostForm && (
        <div className="rounded-md border border-gray-200 p-3">
          <p className="text-sm font-medium text-gray-700">Why was this lead lost?</p>
          <div className="mt-2 space-y-1.5">
            {LOST_REASONS.map((reason) => (
              <label key={reason} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="lost-reason"
                  checked={lostReason === reason}
                  onChange={() => setLostReason(reason)}
                />
                {reason}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="lost-reason"
                checked={lostReason === "other"}
                onChange={() => setLostReason("other")}
              />
              Other
            </label>
            {lostReason === "other" && (
              <input
                type="text"
                value={lostReasonOther}
                onChange={(e) => setLostReasonOther(e.target.value)}
                placeholder="What happened?"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            )}
          </div>
          <button
            type="button"
            disabled={isPending || !lostReason || (lostReason === "other" && !lostReasonOther.trim())}
            onClick={() =>
              startTransition(async () => {
                const reason = lostReason === "other" ? lostReasonOther.trim() : lostReason;
                const result = await updateLeadStatusAction(leadId, "LOST", reason);
                handleResult(result);
                if (result.status !== "error") {
                  setShowLostForm(false);
                  setLostReason("");
                  setLostReasonOther("");
                }
              })
            }
            className="mt-3 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            Mark as Lost
          </button>
        </div>
      )}

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
