"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTaskAction, completeTaskAction, deleteTaskAction } from "@/app/desk/tasks/actions";

type LinkedTask = {
  id: string;
  note: string;
  dueDate: Date | null;
  completedAt: Date | null;
};

/** A small follow-up-task list scoped to one lead or customer, reusing
 * the same StaffTask created for /desk/tasks — see that page and
 * docs/DECISIONS.md's 2026-09-29 CRM-buildout entry. Adding a task here
 * automatically links it to this record, so staff never has to hunt for
 * it on the main Tasks list to know what it was about. */
export function LinkedTasksPanel({
  linkType,
  linkId,
  tasks,
}: {
  linkType: "lead" | "customer";
  linkId: string;
  tasks: LinkedTask[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const open = tasks.filter((t) => !t.completedAt);
  const completed = tasks.filter((t) => t.completedAt);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-medium text-gray-900">Follow-up tasks</h2>

      {open.length === 0 && completed.length === 0 && (
        <p className="mt-2 text-sm text-gray-600">Nothing on your list for this one.</p>
      )}

      {open.length > 0 && (
        <ul className="mt-3 space-y-2">
          {open.map((task) => (
            <li key={task.id} className="flex items-start justify-between gap-3 text-sm">
              <div>
                <p className="text-gray-900">{task.note}</p>
                {task.dueDate && (
                  <p className="text-xs text-gray-500">
                    Due {task.dueDate.toLocaleDateString("en-US")}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      await completeTaskAction(task.id);
                      router.refresh();
                    })
                  }
                  className="text-xs text-gray-500 hover:text-green-700 disabled:opacity-50"
                >
                  Done
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      await deleteTaskAction(task.id);
                      router.refresh();
                    })
                  }
                  className="text-xs text-gray-500 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {completed.length > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          {completed.length} completed task{completed.length === 1 ? "" : "s"} on this one.
        </p>
      )}

      <form
        ref={formRef}
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(async () => {
            const result = await createTaskAction({
              note: String(data.get("note") ?? ""),
              dueDate: String(data.get("dueDate") ?? ""),
              [linkType === "lead" ? "leadId" : "customerId"]: linkId,
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
        <input
          name="note"
          required
          placeholder="Add a follow-up reminder…"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <input
          name="dueDate"
          type="date"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
