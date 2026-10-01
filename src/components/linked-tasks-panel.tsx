import { getTaskAssignees } from "@/domains/tasks";
import { NewTaskForm } from "@/app/desk/tasks/new-task-form";
import { TaskRow, type TaskRowData } from "@/app/desk/tasks/task-row";
import { SectionCard, EmptyState } from "@/components/desk/workspace";

type LinkedTask = Omit<TaskRowData, "lead" | "customer" | "job">;
/** Linked views use the exact same versioned actions and editor as the team list. */
export async function LinkedTasksPanel({
  linkType,
  linkId,
  tasks,
}: {
  linkType: "lead" | "customer";
  linkId: string;
  tasks: LinkedTask[];
}) {
  const assignees = await getTaskAssignees();
  return (
    <SectionCard
      title="Follow-up tasks"
      description="These tasks stay linked to this record in every team view."
    >
      {tasks.length ? (
        <ul className="divide-y divide-line">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={{ ...task, lead: null, customer: null, job: null }}
              assignees={assignees}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No follow-ups yet"
          description="Add the next step for this record below."
        />
      )}
      <div className="mt-4">
        <NewTaskForm
          assignees={assignees}
          link={{ [linkType === "lead" ? "leadId" : "customerId"]: linkId }}
        />
      </div>
    </SectionCard>
  );
}
