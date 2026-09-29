"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTaskAction } from "./actions";

/** Standalone task creation on /desk/tasks itself — just a note and an
 * optional due date, no entity picker (linking a task to a specific
 * lead/customer/job happens from that record's own page instead, via
 * LinkedTaskForm, which passes the id along automatically). */
export function NewTaskForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row sm:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await createTaskAction({
            note: String(data.get("note") ?? ""),
            dueDate: String(data.get("dueDate") ?? ""),
          });
          if (result.status === "error") {
            setError(result.message);
            return;
          }
          setError(null);
          formRef.current?.reset();
          router.refresh();
        });
      }}
    >
      <div className="flex-1">
        <label htmlFor="task-note" className="sr-only">
          New task
        </label>
        <input
          id="task-note"
          name="note"
          required
          placeholder="e.g. Call the Oak Street property manager back about renewing"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {error && (
          <p role="alert" className="mt-1 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
      <input
        name="dueDate"
        type="date"
        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Adding…" : "Add task"}
      </button>
    </form>
  );
}
