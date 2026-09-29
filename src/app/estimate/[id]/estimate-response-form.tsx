"use client";

import { useEffect, useState, useTransition } from "react";
import { approveEstimateAction, requestEstimateChangesAction, type EstimateResponseState } from "./actions";

export function EstimateResponseForm({ estimateId }: { estimateId: string }) {
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"choose" | "approve" | "changes">("choose");
  const [approverName, setApproverName] = useState("");
  const [approverEmail, setApproverEmail] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<EstimateResponseState>({ status: "idle" });

  // Send the browser on to Stripe Checkout for the deposit — an effect,
  // not a render-time assignment, since navigating away is a side
  // effect, not something that can happen while rendering.
  useEffect(() => {
    if (result.status === "redirecting") {
      window.location.href = result.url;
    }
  }, [result]);

  if (result.status === "redirecting") {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-700">
        <p>Thanks — taking you to a secure page to pay the deposit…</p>
      </div>
    );
  }
  if (result.status === "approved") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-900">
        <p className="font-medium">Thanks — you approved this estimate.</p>
        <p className="mt-1">We&apos;ll be in touch about next steps.</p>
      </div>
    );
  }
  if (result.status === "changes_requested") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-medium">Thanks — we got your request.</p>
        <p className="mt-1">We&apos;ll follow up with a revised estimate.</p>
      </div>
    );
  }

  function handleApprove(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      setResult(await approveEstimateAction(estimateId, { approverName, approverEmail }));
    });
  }

  function handleRequestChanges(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      setResult(await requestEstimateChangesAction(estimateId, { message }));
    });
  }

  if (mode === "approve") {
    return (
      <form onSubmit={handleApprove} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
        <p className="text-sm text-gray-700">Enter your name and email to approve this estimate.</p>
        <div>
          <label htmlFor="approverName" className="block text-sm font-medium text-gray-700">
            Your full name
          </label>
          <input
            id="approverName"
            type="text"
            required
            value={approverName}
            onChange={(e) => setApproverName(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="approverEmail" className="block text-sm font-medium text-gray-700">
            Your email
          </label>
          <input
            id="approverEmail"
            type="email"
            required
            value={approverEmail}
            onChange={(e) => setApproverEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isPending ? "Submitting…" : "Approve estimate"}
          </button>
          <button
            type="button"
            onClick={() => setMode("choose")}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-gray-400"
          >
            Back
          </button>
        </div>
        {result.status === "error" && (
          <p role="alert" className="text-sm text-red-700">
            {result.message}
          </p>
        )}
      </form>
    );
  }

  if (mode === "changes") {
    return (
      <form
        onSubmit={handleRequestChanges}
        className="space-y-4 rounded-lg border border-gray-200 bg-white p-5"
      >
        <div>
          <label htmlFor="changes-message" className="block text-sm font-medium text-gray-700">
            What would you like changed?
          </label>
          <textarea
            id="changes-message"
            required
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isPending ? "Sending…" : "Send request"}
          </button>
          <button
            type="button"
            onClick={() => setMode("choose")}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-gray-400"
          >
            Back
          </button>
        </div>
        {result.status === "error" && (
          <p role="alert" className="text-sm text-red-700">
            {result.message}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => setMode("approve")}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        Approve estimate
      </button>
      <button
        type="button"
        onClick={() => setMode("changes")}
        className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-gray-400"
      >
        Request changes
      </button>
    </div>
  );
}
