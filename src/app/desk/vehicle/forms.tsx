"use client";
import { useActionState, type ReactNode } from "react";
import type { VehicleActionState } from "./actions";

type Action = (prev: VehicleActionState, fd: FormData) => Promise<VehicleActionState>;

export function VehicleForm({ action, submit, children, secondary = false }: { action: Action; submit: string; children?: ReactNode; secondary?: boolean }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as VehicleActionState);
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

export function Field({ label, name, type = "text", defaultValue, required = false, hint, min, max, inputMode }: { label: string; name: string; type?: string; defaultValue?: string | number; required?: boolean; hint?: string; min?: number; max?: number; inputMode?: "numeric" | "text" }) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input name={name} type={type} defaultValue={defaultValue} required={required} min={min} max={max} inputMode={inputMode} className="min-h-11 rounded-control border border-line p-2" />
      {hint ? <span className="text-xs font-normal text-ink-soft">{hint}</span> : null}
    </label>
  );
}

export function Select({ label, name, defaultValue, options }: { label: string; name: string; defaultValue?: string; options: Array<[string, string]> }) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <select name={name} defaultValue={defaultValue} className="min-h-11 rounded-control border border-line p-2">
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </label>
  );
}
