"use client";

import { useActionState, type ReactNode } from "react";
type ActionState = { error: string; success: string };
export const emptyTaxActionState: ActionState = { error: "", success: "" };

/** Displays server-verified results beside the form, never only as a toast. */
export function TaxActionForm({
  action, children, title, submitLabel = "Save changes",
}: {
  action: (state: ActionState, data: FormData) => Promise<ActionState>;
  children: ReactNode; title: string; submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, emptyTaxActionState);
  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children}
      {state.error && <p role="alert" className="text-sm font-medium text-destructive">{state.error}</p>}
      {state.success && <p role="status" className="text-sm text-foreground">{state.success}</p>}
      <button type="submit" disabled={pending}
        className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

