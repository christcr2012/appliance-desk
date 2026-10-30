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
  Card,
  EmptyState,
} from "@/components/ui";
import { ScreenHeader, StatusTabs } from "@/components/kit";
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
      <ScreenHeader
        title="Tasks"
        list
        overflow={[{ kind: "link", label: "Back to Today", href: "/desk/today" }]}
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        Shared team follow-ups, linked to the people and jobs they concern. Due dates follow the Colorado business calendar.
      </p>

      <div id="new-task" className="mb-6 scroll-mt-4">
        <Card
          title="Add a follow-up"
          description="Give the team a clear next step and an optional due date."
        >
          <NewTaskForm assignees={assignees} />
        </Card>
      </div>

      <StatusTabs
        label="Choose task view"
        param="view"
        current={view}
        items={TASK_VIEWS.map((item) => ({
          value: item.value,
          label: item.label,
        }))}
      />

      <StatusTabs
        label="Filter tasks by due date"
        param="due"
        current={filter}
        items={TASK_FILTERS.map((item) => ({
          value: item.value,
          label:
            view === "completed" && item.value === "all"
              ? "All due dates"
              : item.label,
        }))}
      />

      <Card
        title={`${TASK_VIEWS.find((item) => item.value === view)!.label} · ${
          view === "completed" && filter === "all"
            ? "All due dates"
            : TASK_FILTERS.find((item) => item.value === filter)!.label
        }`}
        description={`${pagination.totalCount} ${
          view === "completed" ? "completed" : "open"
        } ${pagination.totalCount === 1 ? "task" : "tasks"}`}
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
      </Card>
    </div>
  );
}
