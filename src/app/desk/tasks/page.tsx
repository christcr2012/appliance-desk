import Link from "next/link";
import {
  getTaskWorkspace,
  parseTaskFilter,
  TASK_FILTERS,
} from "@/domains/tasks/workspace";
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
  searchParams: Promise<{ due?: string; page?: string }>;
}) {
  const params = await searchParams;
  const filter = parseTaskFilter(params.due);
  const now = new Date();
  const { tasks, ...pagination } = await getTaskWorkspace(
    filter,
    Number(params.page ?? 1),
    now,
  );
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
          <NewTaskForm />
        </SectionCard>
      </div>
      <FilterBar
        label="Filter tasks by due date"
        items={TASK_FILTERS.map((f) => ({
          label: f.label,
          href: `/desk/tasks?due=${f.value}`,
          active: filter === f.value,
        }))}
      />
      <SectionCard
        title={TASK_FILTERS.find((f) => f.value === filter)!.label}
        description={`${pagination.totalCount} open ${pagination.totalCount === 1 ? "task" : "tasks"}`}
      >
        {tasks.length ? (
          <ul className="divide-y divide-line">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} today={businessDateKey(now)} />
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
          buildHref={(page) => `/desk/tasks?due=${filter}&page=${page}`}
        />
      </SectionCard>
    </div>
  );
}
