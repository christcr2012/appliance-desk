import Link from "next/link";
import { getOpenTasks } from "@/domains/tasks";
import { requireRole } from "@/lib/session";
import { NewTaskForm } from "./new-task-form";
import { TaskRow } from "./task-row";

export const metadata = { title: "Tasks" };

/** A staff member's own follow-up list — see the StaffTask model's own
 * comment and docs/DECISIONS.md's 2026-09-29 CRM-buildout entry.
 * OWNER/ADMIN/STAFF — this is a personal-organization tool, not
 * financial data, so it's open to every desk login (see the
 * OPERATIONAL_LINKS vs OWNER_ONLY_LINKS split in the desk layout). */
export default async function TasksPage() {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const tasks = await getOpenTasks();

  const now = new Date();
  const todayString = now.toDateString();
  const overdue = tasks.filter((t) => t.dueDate && t.dueDate.getTime() < now.getTime());
  const dueToday = tasks.filter(
    (t) => t.dueDate && !overdue.includes(t) && t.dueDate.toDateString() === todayString,
  );

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">Tasks</h1>
      <p className="mt-1 text-sm text-gray-600">
        Your own follow-up reminders — separate from the automatic
        alerts on{" "}
        <Link href="/desk/growth" className="underline">
          Growth
        </Link>{" "}
        and{" "}
        <Link href="/desk/today" className="underline">
          Today
        </Link>
        , which the system flags on its own.
      </p>

      <div className="mt-6">
        <NewTaskForm />
      </div>

      {overdue.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-amber-800">Overdue</h2>
          <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-amber-300 bg-amber-50">
            {overdue.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </div>
      )}

      {dueToday.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-gray-900">Due today</h2>
          <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {dueToday.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <h2 className="text-sm font-medium text-gray-900">Everything else</h2>
        {(() => {
          const rest = tasks.filter((t) => !overdue.includes(t) && !dueToday.includes(t));
          return rest.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">
              {tasks.length === 0 ? "Nothing on your list — add one above." : "Nothing else open."}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
              {rest.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          );
        })()}
      </div>
    </div>
  );
}
