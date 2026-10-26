"use client";
import { useActionState, type ReactNode } from "react";
import type { SecurityActionState } from "./actions";

type Action = (prev: SecurityActionState, fd: FormData) => Promise<SecurityActionState>;

/** One small form with its result message. Every field is a normal labeled input. */
export function SecurityForm({ action, submit, children, secondary = false }: { action: Action; submit: string; children?: ReactNode; secondary?: boolean }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as SecurityActionState);
  return (
    <form action={formAction} className="space-y-2">
      {children}
      <button type="submit" disabled={pending} className={secondary ? "min-h-11 rounded-control border border-line px-4 font-medium disabled:opacity-60" : "min-h-11 rounded-control bg-brand px-4 font-semibold text-white disabled:opacity-60"}>
        {pending ? "Working…" : submit}
      </button>
      {state.status === "error" ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
      {state.status === "success" ? <p role="status" className="text-sm text-ink">{state.message}</p> : null}
    </form>
  );
}

export function Field({ label, name, type = "text", defaultValue, required = true, max, min, hint }: { label: string; name: string; type?: string; defaultValue?: string | number; required?: boolean; max?: number; min?: number; hint?: string }) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input name={name} type={type} defaultValue={defaultValue} required={required} max={max} min={min} className="min-h-11 rounded-control border border-line p-2" />
      {hint ? <span className="text-xs font-normal text-ink-soft">{hint}</span> : null}
    </label>
  );
}

export function TextArea({ label, name, required = true }: { label: string; name: string; required?: boolean }) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <textarea name={name} required={required} rows={3} maxLength={1000} className="rounded-control border border-line p-2" />
    </label>
  );
}

export function Check({ label, name, defaultChecked, hint }: { label: string; name: string; defaultChecked: boolean; hint: string }) {
  return (
    <label className="flex min-h-11 items-start gap-3 text-sm">
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="mt-1 h-5 w-5" />
      <span><span className="font-medium">{label}</span><br /><span className="text-ink-soft">{hint}</span></span>
    </label>
  );
}
