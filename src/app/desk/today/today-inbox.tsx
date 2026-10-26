"use client";
// AR-0b Today inbox (docs/build-specs/screens/TODAY.md section 5): the server renders every card; this wrapper hides a
// card the moment it is snoozed (optimistic, KIT 6.4) and owns the "Snooze this item" sheet. The ⋯ menu's "Snooze…"
// is a real link (?snooze=<key>) so it also works before this script loads; here the click is caught and the sheet
// opens in place without leaving the page.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useOptimistic, useState, useTransition, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { Sheet, plainError, toast } from "@/components/kit";
import { businessDateFromKey, formatShortDate } from "@/lib/business-date";

export type InboxEntry = { key: string; todoKey?: string; title: string; node: ReactNode };
type ServerAction = (fd: FormData) => Promise<unknown>;

export const SNOOZE_REASONS = ["Waiting on the customer", "Waiting on a part", "Handled outside the app", "Other"] as const;

export function TodayInbox({
  entries,
  snoozeAction,
  resumeAction,
  dates,
  initialSnoozeKey,
  children,
}: {
  entries: InboxEntry[];
  snoozeAction?: ServerAction;
  resumeAction?: ServerAction;
  /** YYYY-MM-DD in Colorado: earliest (tomorrow), latest (90 days) and the starting value (3 business days). */
  dates: { min: string; max: string; initial: string };
  initialSnoozeKey?: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/desk/today";
  const search = useSearchParams()?.toString() ?? "";
  const [hidden, hide] = useOptimistic<string[], string>([], (current, key) => [...current, key]);
  const [, startTransition] = useTransition();
  const known = (key: string | undefined) => (key ? entries.find((entry) => entry.todoKey === key) : undefined);
  const [snoozing, setSnoozing] = useState<InboxEntry | null>(() => (snoozeAction ? (known(initialSnoozeKey) ?? null) : null));

  function clearSnoozeParam() {
    const params = new URLSearchParams(search);
    if (!params.has("snooze")) return;
    params.delete("snooze");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!snoozeAction) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!anchor) return;
    let key: string | null = null;
    try {
      key = new URL(anchor.getAttribute("href") ?? "", window.location.href).searchParams.get("snooze");
    } catch {
      return;
    }
    const entry = known(key ?? undefined);
    if (!entry) return;
    event.preventDefault();
    setSnoozing(entry);
  }

  function submit(data: FormData) {
    const entry = snoozing;
    if (!entry?.todoKey || !snoozeAction) return;
    const until = String(data.get("until") ?? "");
    const choice = String(data.get("reasonChoice") ?? "");
    const reason = choice === "Other" ? String(data.get("reasonOther") ?? "").trim() : choice;
    const form = new FormData();
    form.set("key", entry.todoKey);
    form.set("until", until);
    form.set("reason", reason);
    setSnoozing(null);
    clearSnoozeParam();
    startTransition(async () => {
      hide(entry.key);
      try {
        await snoozeAction(form);
        const day = businessDateFromKey(until);
        toast({
          message: `Snoozed until ${day ? formatShortDate(day) : until}`,
          tone: "good",
          undo: resumeAction
            ? async () => {
                const back = new FormData();
                back.set("key", entry.todoKey!);
                await resumeAction(back);
                router.refresh();
              }
            : undefined,
        });
      } catch (error) {
        toast({ message: plainError(error), tone: "danger" });
      }
    });
  }

  const shown = entries.filter((entry) => !hidden.includes(entry.key));
  return (
    <div onClickCapture={onClickCapture}>
      <ul className="flex flex-col gap-2.5" aria-label="To do">
        {shown.map((entry) => (
          <li key={entry.key}>{entry.node}</li>
        ))}
      </ul>
      {children}
      {snoozeAction ? (
        <SnoozeSheet
          entry={snoozing}
          dates={dates}
          onClose={() => {
            setSnoozing(null);
            clearSnoozeParam();
          }}
          onSubmit={submit}
        />
      ) : null}
    </div>
  );
}

function SnoozeSheet({
  entry,
  dates,
  onClose,
  onSubmit,
}: {
  entry: InboxEntry | null;
  dates: { min: string; max: string; initial: string };
  onClose: () => void;
  onSubmit: (data: FormData) => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState<string>(SNOOZE_REASONS[0]);
  const formId = `${id}-snooze`;
  return (
    <Sheet
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Snooze this item"
      footer={
        <button
          type="submit"
          form={formId}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-field bg-primary px-4 text-[15px] font-bold text-on-primary hover:bg-primary-dark lg:min-h-10"
        >
          Snooze
        </button>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
          setChoice(SNOOZE_REASONS[0]);
        }}
      >
        {entry ? <p className="text-sm text-ink-soft">{entry.title}</p> : null}
        <label className="flex flex-col gap-1 text-sm font-bold text-ink" htmlFor={`${id}-until`}>
          Until
          <input
            id={`${id}-until`}
            name="until"
            type="date"
            required
            min={dates.min}
            max={dates.max}
            defaultValue={dates.initial}
            className="min-h-11 rounded-field border border-line-strong bg-surface px-3 text-[15px] font-normal text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold text-ink" htmlFor={`${id}-reason`}>
          Reason
          <select
            id={`${id}-reason`}
            name="reasonChoice"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className="min-h-11 rounded-field border border-line-strong bg-surface px-3 text-[15px] font-normal text-ink"
          >
            {SNOOZE_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
        </label>
        {choice === "Other" ? (
          <label className="flex flex-col gap-1 text-sm font-bold text-ink" htmlFor={`${id}-other`}>
            What is it waiting on?
            <input
              id={`${id}-other`}
              name="reasonOther"
              type="text"
              required
              minLength={3}
              maxLength={200}
              className="min-h-11 rounded-field border border-line-strong bg-surface px-3 text-[15px] font-normal text-ink"
            />
          </label>
        ) : null}
      </form>
    </Sheet>
  );
}
