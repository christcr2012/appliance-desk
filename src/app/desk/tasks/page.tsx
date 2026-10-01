import Link from "next/link";
import {
  getTaskWorkspace,
  parseTaskFilter,
  TASK_FILTERS,
  TASK_VIEWS,
  parseTaskView,
} from "@/domains/tasks/workspace";
import { getTaskAssignees } from "@/domains/tasks";
import { businessDateKey } from "@/lib/business-date";
import {
  PageHeader,
  SectionCard,
  EmptyState,
  FilterBar,
  secondaryActionClass,
} from "@/components/desk/workspace";
import { Pagination } from "@/components/pagination";
import { NewTaskForm } from "./new-task-form";
import { TaskRow } from "./task-row";

export const metadata = { title: "Tasks" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ due?: string; page?: string; view?: string }>;
}) {
  const params = await searchParams;
  const filter = parseTaskFilter(params.due);
  const view = parseTaskView(params.view);
  const now = new Date();
  const [workspace, assignees] = await Promise.all([
    getTaskWorkspace(filter, Number(params.page ?? 1), now, view),
    getTaskAssignees(),
  ]);
  const { tasks, ...pagination } = workspace;
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Tasks"
        description="Shared team follow-ups, linked to the people and jobs they concern. Due dates follow the Colorado business calendar."
        secondaryActions={
          <Link href="/desk/today" className={secondaryActionClass}>
            Back to Today
          </Link>
        }
      />
      <div id="new-task" className="mb-6 scroll-mt-4">
        <SectionCard
          title="Add a follow-up"
          description="Give the team a clear next step and an optional due date."
        >
          <NewTaskForm assignees={assignees} />
        </SectionCard>
      </div>
      <FilterBar
        label="Choose task view"
        items={TASK_VIEWS.map((v) => ({
          label: v.label,
          href: `/desk/tasks?view=${v.value}&due=${filter}`,
          active: view === v.value,
        }))}
      />
      <FilterBar
        label="Filter tasks by due date"
        items={TASK_FILTERS.map((f) => ({
          label:
            view === "completed" && f.value === "all"
              ? "All due dates"
              : f.label,
          href: `/desk/tasks?view=${view}&due=${f.value}`,
          active: filter === f.value,
        }))}
      />
      <SectionCard
        title={`${TASK_VIEWS.find((v) => v.value === view)!.label} · ${view === "completed" && filter === "all" ? "All due dates" : TASK_FILTERS.find((f) => f.value === filter)!.label}`}
        description={`${pagination.totalCount} ${view === "completed" ? "completed" : "open"} ${pagination.totalCount === 1 ? "task" : "tasks"}`}
      >
        {tasks.length ? (
          <ul className="divide-y divide-line">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                assignees={assignees}
                today={businessDateKey(now)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No tasks in this view"
            description="Add a follow-up above, or choose another due-date filter."
          />
        )}
        <Pagination
          {...pagination}
          buildHref={(page) =>
            `/desk/tasks?view=${view}&due=${filter}&page=${page}`
          }
        />
      </SectionCard>
    </div>
  );
}
