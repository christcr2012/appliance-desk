"use client";
// AR-0 kit 4.15: in-house toasts. Mount <Toaster /> once per layout; call toast() from any client code.
import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "./icons";
import type { Tone } from "./types";

export type ToastInput = { message: string; tone?: Tone; undo?: () => Promise<void> };
type ToastEntry = ToastInput & { id: number };

export const TOAST_MS = 6000;
export const TOAST_UNDO_MS = 10000;

let entries: ToastEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Show a short message. With `undo`, the toast stays 10 seconds and offers an "Undo" button. */
export function toast(input: ToastInput): number {
  const id = nextId++;
  entries = [...entries, { ...input, id }].slice(-3);
  emit();
  return id;
}

export function dismissToast(id: number): void {
  entries = entries.filter((entry) => entry.id !== id);
  emit();
}

/** Test helper: forget every toast. */
export function clearToasts(): void {
  entries = [];
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const EMPTY: ToastEntry[] = [];

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-ink text-canvas",
  good: "bg-ink text-canvas",
  info: "bg-ink text-canvas",
  attention: "bg-warning-bg text-warning-ink border border-warning-ink/30",
  danger: "bg-danger text-on-primary",
};

function ToastItem({ entry }: { entry: ToastEntry }) {
  const [undoing, setUndoing] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(entry.id), entry.undo ? TOAST_UNDO_MS : TOAST_MS);
    return () => clearTimeout(timer);
  }, [entry.id, entry.undo]);
  return (
    <div
      className={`pointer-events-auto flex w-full max-w-[420px] items-center gap-3 rounded-field px-4 py-3 text-sm font-semibold shadow-raise ${TONE_CLASS[entry.tone ?? "neutral"]}`}
      data-tone={entry.tone ?? "neutral"}
    >
      <span className="min-w-0 flex-1">{entry.message}</span>
      {entry.undo ? (
        <button
          type="button"
          disabled={undoing}
          onClick={async () => {
            setUndoing(true);
            try {
              await entry.undo!();
              dismissToast(entry.id);
            } catch (error) {
              dismissToast(entry.id);
              toast({ message: plainError(error), tone: "danger" });
            }
          }}
          className="min-h-11 rounded-field px-3 font-extrabold underline underline-offset-2 disabled:opacity-60"
        >
          Undo
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(entry.id)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-field"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

/** One live region for every toast (KIT 4.15): bottom-center on phones above the bottom bar, bottom-right on desktop. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => entries, () => EMPTY);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-5 lg:inset-x-auto lg:right-6 lg:bottom-6 lg:items-end lg:px-0"
    >
      {list.map((entry) => (
        <ToastItem key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

/** The server's plain message, never a raw error (KIT 6.3). */
export function plainError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  // Production hides server error text behind a generic line; show a plain sentence instead of it.
  if (!message || /server components render|digest|unexpected response/i.test(message)) {
    return "That didn't work. Try again.";
  }
  return message;
}
