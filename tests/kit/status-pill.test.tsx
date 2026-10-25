import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StatusPill, PILL_TONE } from "@/components/kit";
import { GLOSSARY } from "@/lib/glossary";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(cleanup);

describe("kit StatusPill (KIT 4.17)", () => {
  it.each([
    ["good", "bg-success-soft text-success"],
    ["attention", "bg-warning-bg text-warning-ink"],
    ["info", "bg-info-soft text-info-ink"],
    ["danger", "bg-danger/10 text-danger"],
    ["neutral", "bg-tint text-ink-soft"],
  ] as const)("%s tone uses %s", (tone, classes) => {
    render(<StatusPill label="Paid" tone={tone} />);
    const pill = screen.getByText("Paid");
    expect(PILL_TONE[tone]).toBe(classes);
    for (const name of classes.split(" ")) expect(pill.className).toContain(name);
    expect(pill.className).toContain("rounded-full");
    expect(pill.className).toContain("text-xs");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("with info, is a button that opens the glossary entry and closes on Escape", async () => {
    render(<StatusPill label="5 days late" tone="attention" info="set-price" />);
    const button = screen.getByRole("button", { name: "5 days late: what this means" });
    await act(async () => fireEvent.click(button));
    const note = screen.getByRole("note");
    expect(note.textContent).toContain(GLOSSARY["set-price"].title);
    expect(note.textContent).toContain(GLOSSARY["set-price"].description);
    await act(async () => fireEvent.keyDown(note, { key: "Escape" }));
    expect(screen.queryByRole("note")).toBeNull();
  });
});
