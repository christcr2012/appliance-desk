"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { writeOffInvoiceAction } from "./actions";

/** Marks one invoice uncollectible — asks for a reason inline (a plain
 * prompt, not a whole modal system for something this infrequent), then
 * calls writeOffInvoiceAction. See
 * src/domains/billing/manual-payments.ts's writeOffInvoice for what this
 * does and doesn't change. */
export function WriteOffButton({ customerId, invoiceId }: { customerId: string; invoiceId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    const reason = window.prompt(
      "Why is this invoice being written off? (e.g. \"Tenant vacated, uncollectible\")",
    );
    if (!reason) return;

    startTransition(async () => {
      const result = await writeOffInvoiceAction(customerId, invoiceId, reason);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="inline-block">
      <button
        type="button"
        disabled={isPending}
        onClick={handleClick}
        className="text-xs text-gray-500 hover:text-red-700 disabled:opacity-50"
      >
        Write off
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
