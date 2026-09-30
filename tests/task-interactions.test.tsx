import { beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const m = vi.hoisted(() => ({
  create: vi.fn(),
  complete: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: m.refresh }),
}));
vi.mock("@/app/desk/tasks/actions", () => ({
  createTaskAction: m.create,
  completeTaskAction: m.complete,
  deleteTaskAction: m.remove,
}));
import { NewTaskForm } from "@/app/desk/tasks/new-task-form";
import { TaskRow } from "@/app/desk/tasks/task-row";
beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("preserves text and date after a rejected save, resets only after confirmed success", async () => {
  m.create
    .mockResolvedValueOnce({ status: "error", message: "Please try again." })
    .mockResolvedValueOnce({ status: "success" });
  render(<NewTaskForm />);
  fireEvent.change(screen.getByLabelText("New task"), {
    target: { value: "Call customer" },
  });
  fireEvent.change(screen.getByLabelText("Due date (optional)"), {
    target: { value: "2026-09-30" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Please try again.",
  );
  expect(screen.getByLabelText("New task")).toHaveValue("Call customer");
  expect(screen.getByLabelText("Due date (optional)")).toHaveValue(
    "2026-09-30",
  );
  expect(m.refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Task added.");
  expect(screen.getByLabelText("New task")).toHaveValue("");
  expect(m.create).toHaveBeenLastCalledWith({
    note: "Call customer",
    dueDate: "2026-09-30",
  });
});
it("does not claim success for an ambiguous network error", async () => {
  m.create.mockRejectedValue(new Error("disconnected"));
  render(<NewTaskForm />);
  fireEvent.change(screen.getByLabelText("New task"), {
    target: { value: "Preserve me" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check the list before trying again",
  );
  expect(screen.getByLabelText("New task")).toHaveValue("Preserve me");
  expect(screen.queryByRole("status")).toBeNull();
});
const task = {
  id: "t1",
  note: "Call customer",
  dueDate: new Date("2026-09-30"),
  customer: null,
  lead: null,
  job: { id: "j1", type: "DELIVERY" },
};
it("requires removal confirmation and preserves linked task on mutation failure", async () => {
  m.remove.mockRejectedValue(new Error("offline"));
  render(
    <ul>
      <TaskRow task={task} today="2026-09-30" />
    </ul>,
  );
  expect(screen.getByText("Due today")).toBeVisible();
  expect(screen.getByRole("link")).toHaveAttribute("href", "/desk/jobs/j1");
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(m.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep task" }));
  expect(screen.queryByRole("button", { name: "Confirm removal" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't save this change",
  );
  expect(screen.getByText("Call customer")).toBeVisible();
  expect(m.refresh).not.toHaveBeenCalled();
});
it("refreshes only after the completion action succeeds", async () => {
  m.complete.mockResolvedValue(undefined);
  render(
    <ul>
      <TaskRow task={task} today="2026-10-01" />
    </ul>,
  );
  expect(screen.getByText(/Overdue/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(m.refresh).toHaveBeenCalledOnce());
  expect(m.complete).toHaveBeenCalledWith("t1");
});
