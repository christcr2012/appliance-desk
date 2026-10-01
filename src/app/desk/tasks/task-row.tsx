"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { businessDateKey, formatTaskDate } from "@/lib/business-date";
import {
  completeTaskAction,
  reopenTaskAction,
  deleteTaskAction,
  updateTaskAction,
  type TaskActionResult,
} from "./actions";
import { TaskFields, readTaskFields, type TaskAssignee } from "./task-fields";
export type TaskRowData = {
  id: string;
  note: string;
  dueDate: Date | null;
  priority: string;
  version: number;
  completedAt: Date | null;
  assignee: TaskAssignee | null;
  lead: { id: string; contactName: string } | null;
  customer: { id: string; user: { name: string | null; email: string } } | null;
  job: { id: string; type: string } | null;
};
export function TaskRow({
  task,
  today = businessDateKey(new Date()),
  assignees = [],
}: {
  task: TaskRowData;
  today?: string;
  assignees?: TaskAssignee[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const editVersion = useRef(task.version);
  const dueKey = task.dueDate
    ? new Date(task.dueDate).toISOString().slice(0, 10)
    : null;
  const links = [
    ...(task.lead
      ? [{ href: `/desk/leads/${task.lead.id}`, label: task.lead.contactName }]
      : []),
    ...(task.customer
      ? [
          {
            href: `/desk/customers/${task.customer.id}`,
            label: task.customer.user.name ?? task.customer.user.email,
          },
        ]
      : []),
    ...(task.job
      ? [
          {
            href: `/desk/jobs/${task.job.id}`,
            label: `Job — ${task.job.type.replaceAll("_", " ").toLowerCase()}`,
          },
        ]
      : []),
  ];
  function showError(message: string) {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  }
  function mutate(
    action: () => Promise<TaskActionResult>,
    message: string,
    closeEdit = false,
  ) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.status !== "success") {
          showError(result.message);
          return;
        }
        setSaved(message);
        if (closeEdit) setEditing(false);
        router.refresh();
      } catch {
        showError(
          "Couldn't save this change. Your text is preserved; reload the list before trying again.",
        );
      }
    });
  }
  const button =
    "min-h-11 rounded-lg border border-control px-3 text-sm font-medium text-ink disabled:opacity-60";
  return (
    <li className="py-4 text-sm">
      <p className="break-words font-medium text-ink">{task.note}</p>
      <p className="mt-1 break-words text-xs text-ink-soft">
        {task.completedAt ? "Completed · " : ""}
        {task.priority.charAt(0) + task.priority.slice(1).toLowerCase()}{" "}
        priority ·{" "}
        {task.assignee
          ? `${task.assignee.name ?? task.assignee.email}${task.assignee.archivedAt ? " (inactive)" : ""}`
          : "Unassigned"}
      </p>
      <p className="mt-1 break-words text-xs text-ink-soft">
        {task.dueDate ? (
          <span>
            {!task.completedAt && dueKey! < today ? "Overdue · " : ""}
            {dueKey === today
              ? "Due today"
              : `Due ${formatTaskDate(task.dueDate)}`}
          </span>
        ) : (
          "No due date"
        )}
        {links.map((link) => (
          <span key={link.href}>
            {" "}
            ·{" "}
            <Link href={link.href} className="underline">
              {link.label}
            </Link>
          </span>
        ))}
      </p>
      {editing && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = readTaskFields(e.currentTarget);
            mutate(
              () => updateTaskAction(task.id, editVersion.current, data),
              "Task updated.",
              true,
            );
          }}
        >
          <TaskFields
            assignees={assignees}
            disabled={isPending}
            note={task.note}
            noteLabel="Task note"
            dueDate={dueKey ?? ""}
            priority={task.priority}
            assigneeUserId={task.assignee?.id ?? ""}
          />
          <div className="flex gap-2">
            <button disabled={isPending} className={button}>
              Save task
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setEditing(false)}
              className={button}
            >
              Cancel edit
            </button>
          </div>
        </form>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending || editing}
          onClick={() =>
            mutate(
              () =>
                task.completedAt
                  ? reopenTaskAction(task.id, task.version)
                  : completeTaskAction(task.id, task.version),
              task.completedAt ? "Task reopened." : "Task completed.",
            )
          }
          className={button}
        >
          {isPending ? "Saving…" : task.completedAt ? "Reopen" : "Done"}
        </button>
        {!editing && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              editVersion.current = task.version;
              setEditing(true);
              setError(null);
              setSaved(null);
            }}
            className={button}
          >
            Edit task
          </button>
        )}
        {confirmRemove ? (
          <>
            <button
              type="button"
              disabled={isPending || editing}
              onClick={() =>
                mutate(
                  () => deleteTaskAction(task.id, task.version),
                  "Task removed.",
                )
              }
              className={button}
            >
              Confirm removal
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirmRemove(false)}
              className={button}
            >
              Keep task
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={isPending || editing}
            onClick={() => setConfirmRemove(true)}
            className={button}
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
      {saved && (
        <p role="status" className="mt-2 text-sm text-ink">
          {saved}
        </p>
      )}
    </li>
  );
}
