"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { ActionButton, OverflowMenu, Sheet, actionButtonClass, toast, type ActionSpec } from "@/components/kit";
import type { DecisionActionResult } from "./actions";

// DEC-1b: the owner's buttons on one decision card — Keep this, Change…, Ask my…, Enter their answer…, Reopen.
// Admins never get this component (the page renders the cards read-only for them).

type Action = (form: FormData) => Promise<DecisionActionResult>;
type Professional = "CPA" | "ATTORNEY" | "TRANSLATOR";

export type DecisionActionsProps = {
  id: string;
  title: string;
  options: { label: string }[];
  currentIndex: number | null;
  expected: string;
  allowOther: boolean;
  today: string;
  /** Which buttons this card shows (decided on the server from the tab and the question's state). */
  show: { keep: boolean; change: boolean; ask: boolean; answer: boolean; reopen: boolean };
  professionals: Professional[];
  answerLabel: string;
  actions: { keep: Action; change: Action; ask: Action; reopen: Action };
};

const PRO_WORDS: Record<Professional, string> = { CPA: "CPA", ATTORNEY: "attorney", TRANSLATOR: "translator" };
const INPUT = "mt-1 block min-h-11 w-full rounded-field border border-line-strong bg-surface px-3 text-[15px] text-ink";
const LABEL = "block text-sm font-bold text-ink";

function OptionList({ name, options, allowOther, defaultIndex, legend }: {
  name: string; options: { label: string }[]; allowOther: boolean; defaultIndex: number | null; legend: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className={LABEL}>{legend}</legend>
      {options.map((option, index) => (
        <label key={option.label} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-field border border-line px-3 has-[:checked]:border-primary has-[:checked]:bg-success-soft">
          <input type="radio" name={name} value={String(index)} defaultChecked={defaultIndex === index} required className="h-5 w-5 accent-primary" />
          <span className="text-[15px] text-ink">{option.label}</span>
        </label>
      ))}
      {allowOther ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-field border border-line px-3 has-[:checked]:border-primary has-[:checked]:bg-success-soft">
          <input type="radio" name={name} value="OTHER" required className="h-5 w-5 accent-primary" />
          <span className="text-[15px] text-ink">Something else (needs a change to the app)</span>
        </label>
      ) : null}
    </fieldset>
  );
}

function ChangeSheet({ props, onClose }: { props: DecisionActionsProps; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("id", props.id);
    start(async () => {
      const result = await props.actions.change(data);
      if ("error" in result) { setError(result.error); return; }
      toast({ message: result.success, tone: "good" });
      onClose();
    });
  };
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={`Change: ${props.title}`}
      footer={<button type="submit" form={formId} disabled={pending} className={actionButtonClass({ spec: { kind: "link", label: "", href: "" }, variant: "primary", className: "w-full" })}>{pending ? "Saving…" : "Save change"}</button>}>
      <form id={formId} onSubmit={submit} className="space-y-4">
        <OptionList name="option" options={props.options} allowOther={false} defaultIndex={props.currentIndex} legend="New answer" />
        <label className={LABEL}>Starts on
          <input type="date" name="effectiveFrom" min={props.today} defaultValue={props.today} className={INPUT} />
        </label>
        <label className={LABEL}>Note (optional)
          <textarea name="note" maxLength={4000} rows={3} className={`${INPUT} py-2`} />
        </label>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </form>
    </Sheet>
  );
}

function AnswerSheet({ props, onClose }: { props: DecisionActionsProps; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  const formId = useId();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("id", props.id);
    start(async () => {
      try {
        const response = await fetch("/api/desk/decisions/answer", { method: "POST", body: data });
        const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
        if (!response.ok) { setError(body.error ?? "That couldn't be saved. Try again."); return; }
        toast({ message: body.message ?? "Their answer was saved.", tone: "good" });
        onClose();
        router.refresh();
      } catch {
        setError("That couldn't be saved. Check your connection and try again.");
      }
    });
  };
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={`${props.answerLabel}: ${props.title}`}
      footer={<button type="submit" form={formId} disabled={pending} className={actionButtonClass({ spec: { kind: "link", label: "", href: "" }, variant: "primary", className: "w-full" })}>{pending ? "Saving…" : "Save their answer"}</button>}>
      <form id={formId} onSubmit={submit} onChange={(event) => {
        const target = event.target as unknown as HTMLInputElement;
        if (target.name === "option") setOther(target.value === "OTHER");
      }} className="space-y-4">
        <OptionList name="option" options={props.options} allowOther={props.allowOther} defaultIndex={null} legend="Their answer" />
        {other ? (
          <label className={LABEL}>What they answered
            <textarea name="otherText" required maxLength={1000} rows={2} className={`${INPUT} py-2`} />
          </label>
        ) : null}
        <label className={LABEL}>Starts on
          <input type="date" name="effectiveFrom" min={props.today} defaultValue={props.today} className={INPUT} />
        </label>
        <label className={LABEL}>Who answered
          <input name="professionalName" required maxLength={120} autoComplete="off" className={INPUT} />
        </label>
        <label className={LABEL}>Firm (optional)
          <input name="professionalFirm" maxLength={120} autoComplete="off" className={INPUT} />
        </label>
        <label className={LABEL}>Date they answered
          <input type="date" name="answeredOn" required max={props.today} defaultValue={props.today} className={INPUT} />
        </label>
        <label className={LABEL}>Their explanation (optional)
          <textarea name="explanation" maxLength={4000} rows={4} className={`${INPUT} py-2`} />
        </label>
        <label className={LABEL}>Their completed form (optional, PDF or Word, up to 4 MB)
          <input type="file" name="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="mt-1 block w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-field file:border file:border-line-strong file:bg-surface file:px-3 file:font-bold" />
        </label>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </form>
    </Sheet>
  );
}

export function DecisionActions(props: DecisionActionsProps) {
  const [open, setOpen] = useState<"change" | "answer" | null>(null);
  const keep: ActionSpec = { kind: "form", label: "Keep this", action: props.actions.keep, primary: true,
    fields: { id: props.id, expected: props.expected }, pendingLabel: "Saving…" };
  const reopen: ActionSpec = { kind: "form", label: "Reopen", action: props.actions.reopen, fields: { id: props.id },
    pendingLabel: "Saving…" };
  return (
    <>
      {props.show.keep ? <ActionButton spec={keep} variant="primary" /> : null}
      {props.show.answer ? (
        <button type="button" onClick={() => setOpen("answer")} className={actionButtonClass({ spec: keep, variant: "primary" })}>
          {props.answerLabel}…
        </button>
      ) : null}
      {props.show.change ? (
        <button type="button" onClick={() => setOpen("change")} className={actionButtonClass({ spec: keep, variant: "secondary" })}>
          Change…
        </button>
      ) : null}
      {props.show.ask ? (
        <OverflowMenu
          triggerText="Ask my…"
          label={`Ask a professional about ${props.title}`}
          items={props.professionals.map((pro) => ({
            kind: "form" as const, label: `Ask my ${PRO_WORDS[pro]}`, action: props.actions.ask,
            fields: { id: props.id, audience: pro },
          }))}
        />
      ) : null}
      {props.show.reopen ? <ActionButton spec={reopen} variant="secondary" /> : null}
      {open === "change" ? <ChangeSheet props={props} onClose={() => setOpen(null)} /> : null}
      {open === "answer" ? <AnswerSheet props={props} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
