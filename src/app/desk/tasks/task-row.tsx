"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { completeTaskAction, deleteTaskAction } from "./actions";

type Task = {
  id: string;
  note: string;
  dueDate: Date | null;
  lead: { id: string; contactName: string } | null;
  customer: { id: string; user: { name: string | null; email: string } } | null;
  job: { id: string; type: string } | null;
};

function formatDue(date: Date): { text: string; overdue: boolean } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(date);
  due.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { text: `Due ${date.toLocaleDateString("en-US")}`, overdue: true };
  if (days === 0) return { text: "Due today", overdue: false };
  if (days === 1) return { text: "Due tomorrow", overdue: false };
  return { text: `Due ${date.toLocaleDateString("en-US")}`, overdue: false };
}

export function TaskRow({ task }: { task: Task }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const due = task.dueDate ? formatDue(task.dueDate) : null;
  const linkedTo = task.lead
    ? { href: `/desk/leads/${task.lead.id}`, label: task.lead.contactName }
    : task.customer
      ? {
          href: `/desk/customers/${task.customer.id}`,
          label: task.customer.user.name ?? task.customer.user.email,
        }
      : task.job
        ? { href: `/desk/jobs/${task.job.id}`, label: `Job — ${task.job.type}` }
        : null;

  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
      <div>
        <p className="text-gray-900">{task.note}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {due && <span className={due.overdue ? "font-medium text-amber-700" : ""}>{due.text}</span>}
          {due && linkedTo && " · "}
          {linkedTo && (
            <Link href={linkedTo.href} className="underline">
              {linkedTo.label}
            </Link>
          )}
        </p>
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
  );
}
