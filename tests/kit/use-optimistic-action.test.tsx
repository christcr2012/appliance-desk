import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useOptimisticAction } from "@/components/kit/use-optimistic-action";
import { clearToasts, TOAST_UNDO_MS, Toaster } from "@/components/kit/toaster";
import type { ActionSpec } from "@/components/kit/types";

vi.mock("next/navigation", () => import("./kit-test-env"));
beforeEach(() => clearToasts());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type Change = string;
function Example({
  action,
  success = "Snoozed",
  undo,
}: {
  action: ((fd: FormData) => Promise<unknown>) | Extract<ActionSpec, { kind: "form" }>;
  success?: string;
  undo?: () => Promise<unknown>;
}) {
  const { items, run } = useOptimisticAction<string, Change>([], (list, key) => [...list, key], action);
  return (
    <>
      <p data-testid="items">{items.join(",")}</p>
      <button type="button" onClick={() => run("todo-1", new FormData(), { success, undo })}>Snooze</button>
      <button type="button" onClick={() => run("todo-2", new FormData(), { success, undo })}>Snooze another</button>
      <Toaster />
    </>
  );
}

describe("AR-11 useOptimisticAction", () => {
  it("updates immediately, then confirms success and offers Undo only when the write resolves", async () => {
    let resolve!: (value: unknown) => void;
    const action = vi.fn(() => new Promise<unknown>((done) => { resolve = done; }));
    const undo = vi.fn(async () => undefined);
    render(<Example action={action} undo={undo} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Snooze" })));
    expect(screen.getByTestId("items")).toHaveTextContent("todo-1");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    await act(async () => resolve({ ok: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Snoozed");
    expect(TOAST_UNDO_MS).toBe(10000);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("reverts and reports a server-declared failure instead of claiming success", async () => {
    let resolve!: (value: unknown) => void;
    const action = vi.fn(() => new Promise<unknown>((done) => { resolve = done; }));
    render(<Example action={action} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Snooze" })));
    expect(screen.getByTestId("items")).toHaveTextContent("todo-1");
    await act(async () => resolve({ ok: false, error: "Pick a later date." }));
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe(""));
    expect(screen.getByRole("status")).toHaveTextContent("Pick a later date.");
    expect(screen.queryByText("Snoozed")).toBeNull();
  });

  it("reverts when the action throws, and does not expose an unknown raw value", async () => {
    let reject!: (error: unknown) => void;
    const action = vi.fn(() => new Promise<unknown>((_, fail) => { reject = fail; }));
    render(<Example action={action} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Snooze" })));
    expect(screen.getByTestId("items")).toHaveTextContent("todo-1");
    await act(async () => reject(new Error("Date is no longer available.")));
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe(""));
    expect(screen.getByRole("status")).toHaveTextContent("Date is no longer available.");
  });

  it("will never optimistically run an action with a confirmation", () => {
    const action = vi.fn(async () => undefined);
    const formSpec: Extract<ActionSpec, { kind: "form" }> = {
      kind: "form",
      label: "Take payment",
      action,
      confirm: { title: "Take payment?", summary: "This can't be undone.", confirmLabel: "Pay" },
    };
    const { result } = renderHook(() => useOptimisticAction<string, string>([], (all, key) => [...all, key], formSpec));
    expect(() => result.current.run("charge", new FormData(), { success: "Paid" })).toThrow(/cannot run optimistically/);
    expect(action).not.toHaveBeenCalled();
  });

  it("refuses a double-submit while the first action is unsettled", async () => {
    let resolve!: (result: unknown) => void;
    const action = vi.fn(() => new Promise<unknown>((done) => { resolve = done; }));
    render(<Example action={action} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
      fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    });
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => resolve(undefined));
  });

  it("allows a second, distinct To do item while refusing repeats of the first", async () => {
    const resolves: Array<(result: unknown) => void> = [];
    const action = vi.fn(() => new Promise<unknown>((done) => resolves.push(done)));
    render(<Example action={action} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Snooze$/ }));
      fireEvent.click(screen.getByRole("button", { name: "Snooze another" }));
      fireEvent.click(screen.getByRole("button", { name: /^Snooze$/ }));
    });
    expect(action).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("items")).toHaveTextContent("todo-1,todo-2");
    await act(async () => { resolves.forEach(done => done({ ok: true })); });
  });

  it("surfaces an unsuccessful Undo instead of silently saying it worked", async () => {
    const undo = vi.fn(async () => ({ ok: false, error: "Couldn't undo it." }));
    render(<Example action={async () => ({ ok: true })} undo={undo} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Snooze" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't undo it.");
  });
});
