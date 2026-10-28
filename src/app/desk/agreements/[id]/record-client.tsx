"use client";
// AR-4a (RENTALS spec sections 3 + 5): the rental record's two sheets.
// "End this rental…" and "Send a text…" are real links (?end=1 / ?text=1),
// so they work before this script loads; here the clicks are caught and
// the sheets open in place, the same pattern as the customer record.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useRef,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ConfirmDialog, Sheet, toast } from "@/components/kit";
import type { EndOption } from "@/domains/agreements/end-options";
import { endAgreementAction } from "../actions";
import { EndReasonFields } from "./end-reason-fields";

export function RentalRecordClient({
  agreementId,
  endOptions,
  endReasons,
  initialEndOpen,
  initialTextOpen,
  monthToMonthForm,
  textPanel,
  children,
}: {
  agreementId: string;
  endOptions: EndOption[];
  endReasons: string[];
  initialEndOpen: boolean;
  initialTextOpen: boolean;
  monthToMonthForm: ReactNode | null;
  textPanel: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? `/desk/agreements/${agreementId}`;
  const search = useSearchParams()?.toString() ?? "";
  const [endOpen, setEndOpen] = useState(initialEndOpen);
  const [textOpen, setTextOpen] = useState(initialTextOpen);
  const [step, setStep] = useState<"choose" | "month" | "today">("choose");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const reasonFormRef = useRef<HTMLFormElement>(null);

  const endToday = endOptions.find((o) => o.key === "end-today");

  function dropParams(...names: string[]) {
    const params = new URLSearchParams(search);
    let changed = false;
    for (const name of names) {
      if (params.has(name)) {
        params.delete(name);
        changed = true;
      }
    }
    if (!changed) return;
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!anchor) return;
    let url: URL;
    try {
      url = new URL(anchor.getAttribute("href") ?? "", window.location.href);
    } catch {
      return;
    }
    if (url.pathname !== pathname) return;
    if (url.searchParams.get("end") === "1") {
      event.preventDefault();
      setStep("choose");
      setEndOpen(true);
    } else if (url.searchParams.get("text") === "1") {
      event.preventDefault();
      setTextOpen(true);
    }
  }

  function confirmEndToday() {
    const fd = reasonFormRef.current
      ? new FormData(reasonFormRef.current)
      : new FormData();
    const reason = String(fd.get("endReason") ?? "");
    const note = String(fd.get("endReasonNote") ?? "");
    setError(null);
    startTransition(async () => {
      const result = await endAgreementAction(agreementId, {
        reason: reason || null,
        note: note || null,
      });
      if (result.status === "error") {
        setConfirmOpen(false);
        setError(result.message);
        return;
      }
      setConfirmOpen(false);
      setEndOpen(false);
      dropParams("end");
      toast({ message: "Rental ended. A pickup visit is in your To do list." });
      router.refresh();
    });
  }

  return (
    <div onClickCapture={onClickCapture} className="px-1 sm:px-0">
      {children}
      <Sheet
        open={endOpen}
        onOpenChange={(next) => {
          setEndOpen(next);
          if (!next) dropParams("end");
        }}
        title="End this rental"
      >
        <p className="text-sm text-ink-soft" aria-label="Step">
          <span className={step === "choose" ? "font-bold text-ink" : undefined}>Choose</span>
          {" · "}
          <span className={step !== "choose" ? "font-bold text-ink" : undefined}>Decide</span>
          {" · "}Done
        </p>
        {step === "choose" && (
          <div className="mt-4 grid gap-2.5">
            {endOptions.map((option) =>
              option.key === "month-to-month" ? (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setStep("month")}
                  className="min-h-11 rounded-field border border-line-strong bg-surface px-4 py-3 text-left text-ink hover:bg-tint"
                >
                  <span className="font-bold">{option.title}</span>
                  <span className="mt-1 block text-sm font-normal text-ink-soft">{option.line}</span>
                </button>
              ) : option.key === "end-today" ? (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setStep("today")}
                  className="min-h-11 rounded-field border border-line-strong bg-surface px-4 py-3 text-left text-ink hover:bg-tint"
                >
                  <span className="font-bold">{option.title}</span>
                  <span className="mt-1 block text-sm font-normal text-ink-soft">{option.line}</span>
                </button>
              ) : (
                <Link
                  key={option.key}
                  href={`${option.href}?from=end`}
                  className="block min-h-11 rounded-field border border-line-strong bg-surface px-4 py-3 text-ink hover:bg-tint"
                >
                  <span className="font-bold">{option.title}</span>
                  <span className="mt-1 block text-sm font-normal text-ink-soft">{option.line}</span>
                </Link>
              ),
            )}
            {endOptions.length === 0 && (
              <p className="text-sm text-ink-soft">There is nothing to end here.</p>
            )}
          </div>
        )}
        {step === "month" && (
          <div className="mt-2">
            <button type="button" onClick={() => setStep("choose")} className="text-sm font-medium text-primary hover:underline">
              &larr; All the ways to end
            </button>
            {monthToMonthForm}
          </div>
        )}
        {step === "today" && endToday?.confirm && (
          <div className="mt-2">
            <button type="button" onClick={() => setStep("choose")} className="text-sm font-medium text-primary hover:underline">
              &larr; All the ways to end
            </button>
            <form ref={reasonFormRef} onSubmit={(e) => e.preventDefault()}>
              <EndReasonFields reasons={endReasons} />
            </form>
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            )}
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirmOpen(true)}
              className="mt-4 min-h-11 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-on-primary hover:opacity-90 disabled:opacity-50"
            >
              {endToday.confirm.confirmLabel}
            </button>
          </div>
        )}
      </Sheet>
      {endToday?.confirm && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          spec={{ ...endToday.confirm, danger: true }}
          onConfirm={confirmEndToday}
        />
      )}
      <Sheet
        open={textOpen}
        onOpenChange={(next) => {
          setTextOpen(next);
          if (!next) dropParams("text");
        }}
        title="Send a text"
      >
        {textPanel}
      </Sheet>
    </div>
  );
}
