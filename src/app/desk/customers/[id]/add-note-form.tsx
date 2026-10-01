"use client";

import { useRef, useState, useTransition } from "react";
import { createTaskAction } from "@/app/desk/tasks/actions";
import { useRouter } from "next/navigation";
import { addCustomerNoteAction } from "../actions";

/** Quick-action note form on a customer's own page — see
 * src/app/desk/customers/actions.ts's addCustomerNoteAction and the
 * CustomerNote model's own comment for why notes exist separately from
 * the system-generated activity feed. */
export function AddNoteForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [taskSaved, setTaskSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        const body = new FormData(e.currentTarget).get("body");
        if (typeof body !== "string") return;
        startTransition(async () => {
          const result = await addCustomerNoteAction(customerId, body);
          if (result.status === "error") {
            setError(result.message);
            return;
          }
          setError(null);
          formRef.current?.reset();
          router.replace(`/desk/customers/${customerId}?tab=activity`);
          router.refresh();
        });
      }}
    >
      <label htmlFor="note-body" className="sr-only">
        Add a note
      </label>
      <textarea
        id="note-body"
        name="body"
        rows={2}
        required
        placeholder="Log a call, or leave a reminder for next time…"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="mt-2 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Add note"}
      </button>
      <button
        type="button"
        disabled={isPending}
        className="ml-3 min-h-11 text-sm text-ink underline"
        onClick={() => {
          const body = formRef.current
            ? new FormData(formRef.current).get("body")
            : null;
          if (typeof body !== "string" || !body.trim()) {
            setError("Write the follow-up in the note field first.");
            return;
          }
          setTaskSaved(false);
          startTransition(async () => {
            try {
              const result = await createTaskAction({ note: body, customerId });
              if (result.status !== "success") {
                setError(result.message);
                return;
              }
              setError(null);
              setTaskSaved(true);
              router.refresh();
            } catch {
              setError(
                "Couldn't confirm the task was saved. Your note is preserved; check the task list before retrying.",
              );
            }
          });
        }}
      >
        Make this a task
      </button>
      {taskSaved && (
        <p role="status" className="mt-2 text-sm text-ink">
          Follow-up task added and linked to this record.
        </p>
      )}
    </form>
  );
}
