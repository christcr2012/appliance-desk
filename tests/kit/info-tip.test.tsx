import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InfoTip } from "@/components/kit";
import { GLOSSARY } from "@/lib/glossary";

vi.mock("next/navigation", () => import("./kit-test-env"));
afterEach(cleanup);

describe("kit InfoTip (AR-0b)", () => {
  it("is a named button that opens the glossary entry and closes on Escape", async () => {
    render(<InfoTip term="week-money-in" />);
    const button = screen.getByRole("button", { name: "What does Money in mean?" });
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    await act(async () => fireEvent.click(button));
    const note = screen.getByRole("note");
    expect(note.textContent).toContain(GLOSSARY["week-money-in"].description);
    await act(async () => fireEvent.keyDown(note, { key: "Escape" }));
    expect(screen.queryByRole("note")).toBeNull();
  });
});
