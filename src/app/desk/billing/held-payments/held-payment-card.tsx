"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, StatusPill } from "@/components/ui";
import { resolveHeldPaymentAction } from "./actions";

type Option = "MARK_PAID" | "CREDIT" | "REFUND";

const OPTION_TEXT: Record<
  Option,
  { title: string; what: string; button: string }
> = {
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
    what: "Send the money back to the card it came from. The invoice stays as it is. Choose this when the customer did not owe it.",
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
      const result = await resolveHeldPaymentAction({
        paymentId: props.paymentId,
        option,
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      if (result.status === "pending") {
        window.alert(result.message);
      }
      router.refresh();
    });
  }

  return (
    <li>
      <Card
        title={`${props.amountLabel} from ${props.customerName}`}
        description={`Paid by card on ${props.receivedLabel} for invoice ${
          props.invoiceNumber
        }, which was already ${props.invoiceStatusLabel.toLowerCase()}${
          props.writtenOffReason
            ? ` (reason given: “${props.writtenOffReason}”)`
            : ""
        }. The money is recorded but is not applied to anything until you choose what to do with it.`}
      >
        <div className="mb-4 rounded-control border border-line bg-subtle p-3 text-sm text-ink">
          <div className="mb-2">
            <StatusPill tone="progress" label="Recommended" />
          </div>
          <p>
            <strong>
              {OPTION_TEXT[props.recommendation.option].title}.
            </strong>{" "}
            {props.recommendation.reason}
          </p>
        </div>

        <ul className="space-y-4">
          {props.options.map((option) => {
            const recommended =
              option === props.recommendation.option;
            return (
              <li
                key={option}
                className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">
                    {OPTION_TEXT[option].title}
                    {recommended ? " (recommended)" : ""}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {OPTION_TEXT[option].what}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={recommended ? "primary" : "secondary"}
                  disabled={pending}
                  onClick={() => choose(option)}
                >
                  {OPTION_TEXT[option].button}
                </Button>
              </li>
            );
          })}
        </ul>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-control border border-line bg-subtle px-3 py-2 text-sm font-semibold text-danger"
          >
            {error}
          </p>
        )}
      </Card>
    </li>
  );
}
