"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { businessDateKey, formatTaskDate } from "@/lib/business-date";
import { completeTaskAction, deleteTaskAction } from "./actions";

type Task = {
  id: string;
  note: string;
  dueDate: Date | null;
  lead: { id: string; contactName: string } | null;
  customer: { id: string; user: { name: string | null; email: string } } | null;
  job: { id: string; type: string } | null;
};

export function TaskRow({
  task,
  today = businessDateKey(new Date()),
}: {
  task: Task;
  today?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const dueKey = task.dueDate
    ? new Date(task.dueDate).toISOString().slice(0, 10)
    : null;
  const linkedTo = task.lead
    ? { href: `/desk/leads/${task.lead.id}`, label: task.lead.contactName }
    : task.customer
      ? {
          href: `/desk/customers/${task.customer.id}`,
          label: task.customer.user.name ?? task.customer.user.email,
        }
      : task.job
        ? {
            href: `/desk/jobs/${task.job.id}`,
            label: `Job — ${task.job.type.replaceAll("_", " ").toLowerCase()}`,
          }
        : null;

  function mutate(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch {
        setError(
          "Couldn't save this change. Your task is still here; please try again.",
        );
        requestAnimationFrame(() => errorRef.current?.focus());
      }
    });
  }
  return (
    <li className="py-4 text-sm">
      <p className="break-words font-medium text-ink">{task.note}</p>
      <p className="mt-1 break-words text-xs text-ink-soft">
        {task.dueDate && (
          <span>
            {dueKey! < today ? "Overdue · " : ""}
            {dueKey === today
              ? "Due today"
              : `Due ${formatTaskDate(task.dueDate)}`}
          </span>
        )}
        {task.dueDate && linkedTo && " · "}
        {linkedTo && (
          <Link href={linkedTo.href} className="underline">
            {linkedTo.label}
          </Link>
        )}
        {!task.dueDate && !linkedTo && "No due date"}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => mutate(() => completeTaskAction(task.id))}
          className="min-h-11 rounded-lg border border-control px-3 text-sm font-medium text-ink disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Done"}
        </button>
        {confirmRemove ? (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => mutate(() => deleteTaskAction(task.id))}
              className="min-h-11 rounded-lg border border-control px-3 text-sm text-ink disabled:opacity-60"
            >
              Confirm removal
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirmRemove(false)}
              className="min-h-11 rounded-lg px-3 text-sm text-ink underline"
            >
              Keep task
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirmRemove(true)}
            className="min-h-11 rounded-lg px-3 text-sm text-ink-soft underline"
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="mt-2 text-sm text-ink"
        >
          {error}
        </p>
      )}
    </li>
  );
}
