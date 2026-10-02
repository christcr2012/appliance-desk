"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPaymentAction } from "./actions";
import { formatCents } from "@/domains/pricing/money";
import { businessDateKey } from "@/lib/business-date";

type OpenInvoiceOption = { id: string; invoiceNumber: number; balanceCents: number };

/** Chris recording a check/cash/bank-transfer payment. With no invoice
 * picked, the amount spreads across every open invoice oldest-due-first. */
export function RecordPaymentForm({
  customerId,
  openInvoices,
}: {
  customerId: string;
  openInvoices: OpenInvoiceOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await recordPaymentAction(customerId, {
        amountDollars: Number(data.get("amountDollars") ?? 0),
        method: (data.get("method") as "check" | "cash" | "bank_transfer" | "other") ?? "check",
        receivedOn: String(data.get("receivedOn") ?? ""),
        invoiceId: String(data.get("invoiceId") ?? ""),
        reference: String(data.get("reference") ?? ""),
        notes: String(data.get("notes") ?? ""),
      });
      if (result.status !== "success") {
        setError(result.status === "error" ? result.message : "Couldn't record that payment.");
        setSuccess(null);
        return;
      }
      setError(null);
      formRef.current?.reset();
      setShowForm(false);
      setSuccess(
        `Applied ${formatCents(result.totalAppliedCents)} across ${result.invoicesTouched} invoice(s).` +
          (result.overpaymentCents > 0
            ? ` ${formatCents(result.overpaymentCents)} left over was added as an account credit.`
            : ""),
      );
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-gray-900">Record a payment</h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="text-sm text-primary hover:underline"
        >
          {showForm ? "Cancel" : "+ Record payment"}
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        For money that came in outside Stripe — a check, cash, or a bank
        transfer you confirmed yourself.
      </p>

      {success && !showForm && (
        <p role="status" className="mt-3 text-sm text-green-700">
          {success}
        </p>
      )}

      {showForm && (
        <form ref={formRef} onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label htmlFor="amountDollars" className="block text-xs font-medium text-gray-700">
                Amount ($)
              </label>
              <input
                id="amountDollars"
                name="amountDollars"
                type="number"
                step="0.01"
                min="0.01"
                required
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="method" className="block text-xs font-medium text-gray-700">
                Method
              </label>
              <select
                id="method"
                name="method"
                defaultValue="check"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="receivedOn" className="block text-xs font-medium text-gray-700">
                Date received
              </label>
              <input
                id="receivedOn"
                name="receivedOn"
                type="date"
                required
                defaultValue={businessDateKey(new Date())}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="invoiceId" className="block text-xs font-medium text-gray-700">
              Apply to
            </label>
            <select
              id="invoiceId"
              name="invoiceId"
              defaultValue=""
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="">All open invoices, oldest first</option>
              {openInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  Invoice #{inv.invoiceNumber} — {formatCents(inv.balanceCents)} owed
                </option>
              ))}
            </select>
          </div>

          <input
            name="reference"
            placeholder="Check # / reference (optional)"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <textarea
            name="notes"
            rows={2}
            placeholder="Notes (optional)"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isPending ? "Recording…" : "Record payment"}
          </button>
        </form>
      )}
    </div>
  );
}
