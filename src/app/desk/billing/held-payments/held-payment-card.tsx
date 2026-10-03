"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveHeldPaymentAction } from "./actions";

type Option = "MARK_PAID" | "CREDIT" | "REFUND";

const OPTION_TEXT: Record<Option, { title: string; what: string; button: string }> = {
  MARK_PAID: {
    title: "Mark the invoice paid",
    what: "Take the write-off back and record this invoice as paid. Your books then show the money as collected. Choose this when the customer really did owe it.",
    button: "Mark invoice paid",
  },
  CREDIT: {
    title: "Keep it as account credit",
    what: "The customer keeps the money as credit that comes off their future bills. The invoice stays written off. Choose this only if the customer asks for it.",
    button: "Keep as credit",
  },
  REFUND: {
    title: "Refund it to their card",
    what: "Send the money back to the card it came from (it can take a few days to show up for them). The invoice stays as it is. Choose this when the customer did not owe it.",
    button: "Refund to card",
  },
};

export type HeldPaymentCardProps = {
  paymentId: string;
  customerName: string;
  invoiceNumber: string;
  invoiceStatusLabel: string;
  amountLabel: string;
  receivedLabel: string;
  writtenOffReason: string | null;
  recommendation: { option: Option; reason: string };
  options: Option[];
};

export function HeldPaymentCard(props: HeldPaymentCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(option: Option) {
    const ok = window.confirm(
      `${OPTION_TEXT[option].title}?\n\n${OPTION_TEXT[option].what}\n\nThis cannot be undone from here.`,
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await resolveHeldPaymentAction({ paymentId: props.paymentId, option });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      if (result.status === "pending") window.alert(result.message);
      router.refresh();
    });
  }

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">
        {props.amountLabel} from {props.customerName}
      </h2>
      <p className="mt-1 text-sm text-gray-700">
        They paid by card on {props.receivedLabel} for invoice {props.invoiceNumber}, which was already{" "}
        {props.invoiceStatusLabel.toLowerCase()}
        {props.writtenOffReason ? ` (reason given: “${props.writtenOffReason}”)` : ""}. The money is safe in your
        records but is not applied to anything until you choose what to do with it.
      </p>

      <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800">
        <strong>Recommended: {OPTION_TEXT[props.recommendation.option].title}.</strong> {props.recommendation.reason}
      </p>

      <ul className="mt-4 space-y-3">
        {props.options.map((option) => {
          const recommended = option === props.recommendation.option;
          return (
            <li key={option} className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {OPTION_TEXT[option].title}
                  {recommended ? " (recommended)" : ""}
                </p>
                <p className="text-sm text-gray-600">{OPTION_TEXT[option].what}</p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => choose(option)}
                className={
                  recommended
                    ? "rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    : "rounded-full border border-gray-400 px-4 py-2 text-sm font-semibold text-gray-900 disabled:opacity-60"
                }
              >
                {OPTION_TEXT[option].button}
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </li>
  );
}
