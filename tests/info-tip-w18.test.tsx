import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InfoTip } from "@/components/ui/info-tip";

describe("W-18 accessible explanations", () => {
  it("opens from keyboard, announces expanded state and closes with Escape", () => {
    render(<InfoTip term="use-tax-threshold" />);
    const toggle = screen.getByRole("button", { name: /use tax reporting threshold/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("note")).toHaveTextContent(/filing frequency/i);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("closes when a person touches another part of the page", () => {
    render(<div><InfoTip term="set-price" /><button type="button">Outside</button></div>);
    fireEvent.click(screen.getByRole("button", { name: /set price/i }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("note")).toBeNull();
  });
});
