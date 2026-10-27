import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TodayInbox } from "@/app/desk/today/today-inbox";
import { Toaster, clearToasts } from "@/components/kit";
import { resetNav, setDesktop } from "./kit/kit-test-env";

vi.mock("next/navigation", () => import("./kit/kit-test-env"));
beforeEach(() => {
  clearToasts();
  setDesktop(true);
  resetNav("/desk/today");
});
afterEach(() => { cleanup(); setDesktop(false); vi.restoreAllMocks(); });

const dates = { min: "2026-10-28", max: "2027-01-25", initial: "2026-10-30" };
const entries = [{
  key: "todo-entry",
  todoKey: "t-1",
  title: "Call the customer",
  node: <a href="/desk/today?snooze=t-1">Snooze this task</a>,
}];
function Harness({
  snoozeAction,
  resumeAction,
}: {
  snoozeAction: (fd: FormData) => Promise<unknown>;
  resumeAction?: (fd: FormData) => Promise<unknown>;
}) {
  return (
    <>
      <TodayInbox entries={entries} dates={dates} snoozeAction={snoozeAction} resumeAction={resumeAction} />
      <Toaster />
    </>
  );
}
async function openAndSubmit() {
  await act(async () => fireEvent.click(screen.getByRole("link", { name: "Snooze this task" })));
  expect(screen.getByRole("dialog", { name: "Snooze this item" })).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Snooze", exact: true })));
}
describe("AR-11 Today inbox shared optimistic helper", () => {
  it("sends the unchanged Snooze fields, hides immediately and offers confirmed Undo", async () => {
    let finish!: (value: unknown) => void;
    const snoozeAction = vi.fn(() => new Promise<unknown>((done) => { finish = done; }));
    const resumeAction = vi.fn(async () => undefined);
    render(<Harness snoozeAction={snoozeAction} resumeAction={resumeAction} />);
    await openAndSubmit();
    expect(snoozeAction).toHaveBeenCalledTimes(1);
    const data = (snoozeAction.mock.calls[0] as unknown as [FormData])[0];
    expect([...data.entries()]).toEqual([
      ["key", "t-1"], ["until", "2026-10-30"], ["reason", "Waiting on the customer"],
    ]);
    expect(screen.queryByRole("link", { name: "Snooze this task" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    await act(async () => finish(undefined));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
    expect(resumeAction).toHaveBeenCalledTimes(1);
    expect((resumeAction.mock.calls[0] as unknown as [FormData])[0].get("key")).toBe("t-1");
  });

  it("restores the task if the server returns a plain error", async () => {
    let finish!: (value: unknown) => void;
    const snoozeAction = vi.fn(() => new Promise<unknown>((done) => { finish = done; }));
    render(<Harness snoozeAction={snoozeAction} />);
    await openAndSubmit();
    expect(screen.queryByRole("link", { name: "Snooze this task" })).toBeNull();
    await act(async () => finish({ ok: false, error: "Please choose another date." }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Snooze this task" })).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Please choose another date.");
    expect(screen.queryByText(/Snoozed until/)).toBeNull();
  });
});
