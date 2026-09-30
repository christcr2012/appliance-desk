"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTaskAction } from "./actions";
import { primaryActionClass } from "@/components/desk/workspace";

export function NewTaskForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  function showError(message: string) {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  }
  return (
    <form
      ref={formRef}
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        setSaved(false);
        startTransition(async () => {
          try {
            const result = await createTaskAction({
              note: String(data.get("note") ?? ""),
              dueDate: String(data.get("dueDate") ?? ""),
            });
            if (result.status === "error") {
              showError(result.message);
              return;
            }
            formRef.current?.reset();
            setSaved(true);
            router.refresh();
          } catch {
            showError(
              "Couldn't confirm this task was saved. Your text is preserved. Check the list before trying again.",
            );
          }
        });
      }}
    >
      <div>
        <label
          htmlFor="task-note"
          className="mb-1 block text-sm font-medium text-ink"
        >
          New task
        </label>
        <input
          id="task-note"
          name="note"
          required
          maxLength={500}
          disabled={isPending}
          placeholder="For example, call a property manager about renewing"
          className="min-h-11 w-full rounded-lg border border-control bg-surface px-3 py-2 text-ink"
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="task-due"
            className="mb-1 block text-sm font-medium text-ink"
          >
            Due date (optional)
          </label>
          <input
            id="task-due"
            name="dueDate"
            type="date"
            disabled={isPending}
            className="min-h-11 max-w-full rounded-lg border border-control bg-surface px-3 py-2 text-ink"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className={`${primaryActionClass} disabled:opacity-60`}
        >
          {isPending ? "Adding…" : "Add task"}
        </button>
      </div>
      {error && (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="text-sm text-ink"
        >
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-ink">
          Task added.
        </p>
      )}
    </form>
  );
}
