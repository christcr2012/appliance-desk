"use client";
import { useActionState, type ReactNode } from "react";
import type { ContinuityState } from "./actions";

type Action = (prev: ContinuityState, fd: FormData) => Promise<ContinuityState>;

export function ContinuityForm({ action, submit, children, danger = false }: { action: Action; submit: string; children?: ReactNode; danger?: boolean }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as ContinuityState);
  return (
    <form action={formAction} className="space-y-3">
      {children}
      <button type="submit" disabled={pending} className={danger ? "min-h-11 rounded-control border border-danger px-4 font-semibold text-danger disabled:opacity-60" : "min-h-11 rounded-control bg-brand px-4 font-semibold text-white disabled:opacity-60"}>
        {pending ? "Working…" : submit}
      </button>
      {state.status === "error" ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
      {state.status === "success" ? <p role="status" className="text-sm text-ink">{state.message}</p> : null}
    </form>
  );
}

export function Field({ label, name, defaultValue, hint, wide = false }: { label: string; name: string; defaultValue?: string | null; hint?: string; wide?: boolean }) {
  return (
    <label className={`grid gap-1 text-sm font-medium${wide ? " md:col-span-2" : ""}`}>
      {label}
      <input name={name} type="text" maxLength={300} defaultValue={defaultValue ?? ""} className="min-h-11 rounded-control border border-line p-2" />
      {hint ? <span className="text-xs font-normal text-ink-soft">{hint}</span> : null}
    </label>
  );
}
