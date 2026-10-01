"use client";
import { useId } from "react";
export type TaskAssignee = {
  id: string;
  name: string | null;
  email: string;
  archivedAt?: Date | null;
};
export function TaskFields({
  assignees = [],
  disabled = false,
  note = "",
  dueDate = "",
  priority = "NORMAL",
  assigneeUserId = "",
  noteLabel = "New task",
}: {
  assignees?: TaskAssignee[];
  disabled?: boolean;
  note?: string;
  dueDate?: string;
  priority?: string;
  assigneeUserId?: string;
  noteLabel?: string;
}) {
  const id = useId();
  const control =
    "min-h-11 w-full rounded-lg border border-control bg-surface px-3 py-2 text-ink";
  return (
    <>
      <div>
        <label
          htmlFor={`${id}-note`}
          className="mb-1 block text-sm font-medium text-ink"
        >
          {noteLabel}
        </label>
        <input
          id={`${id}-note`}
          name="note"
          defaultValue={note}
          required
          maxLength={500}
          disabled={disabled}
          className={control}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label
            htmlFor={`${id}-due`}
            className="mb-1 block text-sm font-medium text-ink"
          >
            Due date (optional)
          </label>
          <input
            id={`${id}-due`}
            name="dueDate"
            type="date"
            defaultValue={dueDate}
            disabled={disabled}
            className={control}
          />
        </div>
        <div>
          <label
            htmlFor={`${id}-priority`}
            className="mb-1 block text-sm font-medium text-ink"
          >
            Priority
          </label>
          <select
            id={`${id}-priority`}
            name="priority"
            defaultValue={priority}
            disabled={disabled}
            className={control}
          >
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
          </select>
        </div>
        <div>
          <label
            htmlFor={`${id}-assignee`}
            className="mb-1 block text-sm font-medium text-ink"
          >
            Assigned to
          </label>
          <select
            id={`${id}-assignee`}
            name="assigneeUserId"
            defaultValue={assigneeUserId}
            disabled={disabled}
            className={control}
          >
            <option value="">Unassigned</option>
            {assigneeUserId &&
              !assignees.some((a) => a.id === assigneeUserId) && (
                <option value={assigneeUserId}>
                  Inactive team member — reassign
                </option>
              )}
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? a.email}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}
export function readTaskFields(form: HTMLFormElement) {
  const data = new FormData(form);
  return Object.fromEntries(
    ["note", "dueDate", "priority", "assigneeUserId"].map((key) => [
      key,
      String(data.get(key) ?? ""),
    ]),
  );
}
